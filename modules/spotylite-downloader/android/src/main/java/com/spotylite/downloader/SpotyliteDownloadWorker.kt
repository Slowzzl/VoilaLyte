package com.spotylite.downloader

import android.content.Context
import android.net.Uri
import android.util.Log
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import androidx.work.Data
import com.yausername.youtubedl_android.YoutubeDL
import com.yausername.youtubedl_android.YoutubeDLRequest
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File

internal class SpotyliteDownloadWorker(
  appContext: Context,
  params: WorkerParameters,
) : CoroutineWorker(appContext, params) {

  companion object {
    private const val TAG = "SpotyliteDownloader"
  }

  override suspend fun doWork(): Result = withContext(Dispatchers.IO) {

    val id = inputData.getString(DownloadContract.KEY_ID)
      ?: return@withContext Result.failure()

    val url = inputData.getString(DownloadContract.KEY_URL)
      ?: return@withContext Result.failure()

    val directoryUri = inputData.getString(DownloadContract.KEY_DIRECTORY)
      ?: return@withContext Result.failure()

    var stage = "Preparação"

    try {
      Log.i(TAG, "Iniciando download: $id")

      val directoryPath = Uri.parse(directoryUri).path
        ?: throw IllegalStateException("Diretório inválido: $directoryUri")

      val directory = File(directoryPath)

      if (!directory.exists() && !directory.mkdirs()) {
        throw IllegalStateException(
          "Não foi possível criar a pasta de músicas."
        )
      }

      stage = "Preparação do yt-dlp"
      YtDlpRuntime.prepare(applicationContext)

      stage = "Obtenção dos metadados"
      Log.i(TAG, "Consultando informações do conteúdo...")

      val info = YoutubeDL.getInstance().getInfo(url)

      Log.i(TAG, "Metadados obtidos.")

      fun infoValue(method: String): String? = runCatching {
        info.javaClass.getMethod(method)
          .invoke(info)
          ?.toString()
          ?.takeIf { it.isNotBlank() }
      }.getOrNull()

      val title = infoValue("getTitle")
        ?: "Áudio importado"

      val artist = infoValue("getUploader")
        ?: "Artista desconhecido"

      val cover = infoValue("getThumbnail")

      val durationMs = (
        (infoValue("getDuration")?.toDoubleOrNull() ?: 0.0) * 1000.0
      ).toLong().coerceAtLeast(0L)

      val outputTemplate = File(
        directory,
        "$id.%(ext)s"
      ).absolutePath

      val request = YoutubeDLRequest(url).apply {
        addOption("--no-warnings")
        addOption("--no-playlist")
        addOption("--no-overwrites")
        addOption("--extract-audio")
        addOption("--audio-format", "mp3")
        addOption("--audio-quality", "0")
        addOption("--output", outputTemplate)
      }

      stage = "Download"

      DownloadContract.send(
        applicationContext,
        mapOf(
          DownloadContract.KEY_ID to id,
          DownloadContract.KEY_STATUS to "downloading",
          DownloadContract.KEY_PROGRESS to 0f
        )
      )

      Log.i(TAG, "Iniciando processamento do conteúdo...")

      YoutubeDL.getInstance().execute(request, id, false) {
        progress, _, _ ->

        val normalizedProgress =
          (progress / 100f).coerceIn(0f, 1f)

        setProgressAsync(
          Data.Builder()
            .putFloat(
              DownloadContract.KEY_PROGRESS,
              normalizedProgress
            )
            .build()
        )

        DownloadContract.send(
          applicationContext,
          mapOf(
            DownloadContract.KEY_ID to id,
            DownloadContract.KEY_STATUS to "downloading",
            DownloadContract.KEY_PROGRESS to normalizedProgress
          )
        )
      }

      stage = "Verificação do arquivo"

      val output = File(directory, "$id.mp3")

      if (!output.exists() || output.length() == 0L) {
        throw IllegalStateException(
          "O processamento terminou, mas o arquivo MP3 não foi encontrado."
        )
      }

      Log.i(TAG, "Arquivo concluído: ${output.absolutePath}")

      DownloadContract.send(
        applicationContext,
        mapOf(
          DownloadContract.KEY_ID to id,
          DownloadContract.KEY_STATUS to "completed",
          DownloadContract.KEY_PROGRESS to 1f,
          DownloadContract.KEY_FILE_NAME to output.name,
          DownloadContract.KEY_TITLE to title,
          DownloadContract.KEY_ARTIST to artist,
          DownloadContract.KEY_ALBUM to "",
          DownloadContract.KEY_COVER to cover,
          DownloadContract.KEY_DURATION to durationMs
        )
      )

      Log.i(TAG, "Download concluído: $id")

      Result.success()

    } catch (error: Throwable) {

      Log.e(
        TAG,
        "Falha na etapa: $stage | ${error.javaClass.name}: ${error.message}",
        error
      )

      if (isStopped) {
        DownloadContract.send(
          applicationContext,
          mapOf(
            DownloadContract.KEY_ID to id,
            DownloadContract.KEY_STATUS to "cancelled"
          )
        )

        return@withContext Result.failure()
      }

      val message = "Falha em $stage: ${
        error.message ?: error.javaClass.simpleName
      }".take(500)

      DownloadContract.send(
        applicationContext,
        mapOf(
          DownloadContract.KEY_ID to id,
          DownloadContract.KEY_STATUS to "failed",
          DownloadContract.KEY_ERROR to message
        )
      )

      Result.failure()
    }
  }
}