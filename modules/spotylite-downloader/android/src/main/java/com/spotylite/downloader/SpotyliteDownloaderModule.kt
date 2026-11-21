package com.spotylite.downloader

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import androidx.core.content.ContextCompat
import androidx.work.BackoffPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import com.yausername.youtubedl_android.YoutubeDL
import com.yausername.youtubedl_android.YoutubeDLRequest
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

class SpotyliteDownloaderModule : Module() {

  private var eventReceiver: BroadcastReceiver? = null

  // Teto de faixas por playlist (listas "Mix"/rádio do YouTube são praticamente infinitas).
  private val maxPlaylistEntries = 200

  override fun definition() = ModuleDefinition {

    Name("SpotyliteDownloader")

    Events("onDownloadEvent")

    OnCreate {
      val context = appContext.reactContext?.applicationContext
        ?: return@OnCreate

      val receiver = object : BroadcastReceiver() {

        override fun onReceive(
          context: Context?,
          intent: Intent?
        ) {
          if (intent == null) return

          val id = intent.getStringExtra(
            DownloadContract.KEY_ID
          ) ?: return

          val status = intent.getStringExtra(
            DownloadContract.KEY_STATUS
          ) ?: return

          val payload = mutableMapOf<String, Any?>(
            "id" to id,
            "status" to status
          )

          if (intent.hasExtra(DownloadContract.KEY_PROGRESS)) {
            payload["progress"] = intent.getFloatExtra(
              DownloadContract.KEY_PROGRESS,
              0f
            ).toDouble()
          }

          if (intent.hasExtra(DownloadContract.KEY_ERROR)) {
            payload["error"] = intent.getStringExtra(
              DownloadContract.KEY_ERROR
            )
          }

          if (status == "completed") {
            payload["result"] = mapOf(
              "id" to id,
              "fileName" to intent.getStringExtra(
                DownloadContract.KEY_FILE_NAME
              ),
              "title" to intent.getStringExtra(
                DownloadContract.KEY_TITLE
              ),
              "artist" to intent.getStringExtra(
                DownloadContract.KEY_ARTIST
              ),
              "album" to intent.getStringExtra(
                DownloadContract.KEY_ALBUM
              ),
              "coverUrl" to intent.getStringExtra(
                DownloadContract.KEY_COVER
              ),
              "durationMs" to intent.getLongExtra(
                DownloadContract.KEY_DURATION,
                0L
              ).toDouble()
            )
          }

          sendEvent("onDownloadEvent", payload)
        }
      }

      eventReceiver = receiver

      ContextCompat.registerReceiver(
        context,
        receiver,
        IntentFilter(DownloadContract.ACTION_EVENT),
        ContextCompat.RECEIVER_NOT_EXPORTED
      )
    }

    OnDestroy {
      val context = appContext.reactContext?.applicationContext
      val receiver = eventReceiver

      if (context != null && receiver != null) {
        runCatching {
          context.unregisterReceiver(receiver)
        }
      }

      eventReceiver = null
    }

    AsyncFunction("isAvailable") {
      true
    }

    AsyncFunction("enqueue") {
      url: String,
      id: String,
      outputDirectory: String ->

      require(
        url.startsWith("https://") ||
        url.startsWith("http://")
      ) {
        "Apenas links HTTP ou HTTPS são aceitos."
      }

      require(
        id.matches(Regex("[A-Za-z0-9_-]{1,100}"))
      ) {
        "Identificador de download inválido."
      }

      require(outputDirectory.startsWith("file://")) {
        "O diretório de destino precisa ser um URI file:// válido."
      }

      val context = appContext.reactContext?.applicationContext
        ?: error("Contexto Android indisponível.")

      val request = OneTimeWorkRequestBuilder<SpotyliteDownloadWorker>()
        .setInputData(
          DownloadContract.input(
            id,
            url,
            outputDirectory
          )
        )
        .setBackoffCriteria(
          BackoffPolicy.EXPONENTIAL,
          20,
          TimeUnit.SECONDS
        )
        .build()

      WorkManager.getInstance(context).enqueueUniqueWork(
        id,
        ExistingWorkPolicy.KEEP,
        request
      )

      DownloadContract.send(
        context,
        mapOf(
          DownloadContract.KEY_ID to id,
          DownloadContract.KEY_STATUS to "queued",
          DownloadContract.KEY_PROGRESS to 0f
        )
      )
    }

    // Lista os vídeos de uma playlist SEM baixar: yt-dlp --flat-playlist -J devolve um único JSON
    // ({ title, entries: [{ id, title, url }] }), bem mais confiável que ler linhas de texto.
    AsyncFunction("resolvePlaylist") { url: String ->

      require(
        url.startsWith("https://") ||
        url.startsWith("http://")
      ) {
        "Apenas links HTTP ou HTTPS são aceitos."
      }

      val context = appContext.reactContext?.applicationContext
        ?: error("Contexto Android indisponível.")

      YtDlpRuntime.prepare(context)

      val request = YoutubeDLRequest(url).apply {
        addOption("--flat-playlist")
        addOption("--yes-playlist")
        addOption("--no-warnings")
        addOption("--ignore-errors")
        addOption("--playlist-end", maxPlaylistEntries.toString())
        addOption("-J")
      }

      val response = try {
        YoutubeDL.getInstance().execute(request)
      } catch (error: Throwable) {
        throw IllegalStateException(
          "yt-dlp não conseguiu ler a playlist: ${error.message ?: error.javaClass.simpleName}".take(400)
        )
      }

      // O JSON é o trecho entre a primeira "{" e a última "}" (ignora qualquer linha extra).
      val raw = response.out
      val start = raw.indexOf('{')
      val end = raw.lastIndexOf('}')
      if (start < 0 || end <= start) {
        throw IllegalStateException(
          "O YouTube não devolveu a lista de vídeos. ${response.err.orEmpty().trim().takeLast(300)}".trim()
        )
      }

      val root = JSONObject(raw.substring(start, end + 1))
      val items = root.optJSONArray("entries") ?: JSONArray()
      val idPattern = Regex("[A-Za-z0-9_-]{6,20}")
      val entries = mutableListOf<Map<String, String>>()

      for (index in 0 until items.length()) {
        val item = items.optJSONObject(index) ?: continue
        val title = item.optString("title", "").trim()

        // Vídeos privados/apagados aparecem na lista, mas não dá para baixá-los.
        if (title.startsWith("[Private video]") || title.startsWith("[Deleted video]")) continue

        val videoId = item.optString("id", "").trim()
        val videoUrl = when {
          idPattern.matches(videoId) -> "https://www.youtube.com/watch?v=$videoId"
          item.optString("url", "").startsWith("http") -> item.optString("url")
          else -> continue
        }

        entries.add(mapOf("url" to videoUrl, "title" to title))
      }

      mapOf(
        "title" to root.optString("title", "").trim().takeIf { it.isNotEmpty() && it != "null" },
        "entries" to entries
      )
    }

    AsyncFunction("cancel") { id: String ->

      val context = appContext.reactContext?.applicationContext
        ?: error("Contexto Android indisponível.")

      WorkManager.getInstance(context).cancelUniqueWork(id)

      DownloadContract.send(
        context,
        mapOf(
          DownloadContract.KEY_ID to id,
          DownloadContract.KEY_STATUS to "cancelled"
        )
      )
    }
  }
}