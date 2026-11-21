package com.spotylite.downloader

import android.content.Context
import android.util.Log
import com.yausername.ffmpeg.FFmpeg
import com.yausername.youtubedl_android.YoutubeDL

/**
 * Prepara yt-dlp + FFmpeg UMA vez por processo e atualiza o yt-dlp (canal estável) uma vez.
 * O YouTube muda com frequência: o yt-dlp embutido no app envelhece e passa a falhar. Antes só o worker
 * atualizava; a consulta da playlist rodava com a versão antiga e falhava. Agora todos passam por aqui,
 * e 50 faixas de uma playlist não disparam 50 atualizações.
 */
internal object YtDlpRuntime {
  private const val TAG = "SpotyliteDownloader"
  private var updateAttempted = false

  @Synchronized
  fun prepare(context: Context) {
    val app = context.applicationContext
    YoutubeDL.getInstance().init(app)
    FFmpeg.getInstance().init(app)

    if (!updateAttempted) {
      updateAttempted = true
      try {
        val status = YoutubeDL.getInstance().updateYoutubeDL(app, YoutubeDL.UpdateChannel._STABLE)
        Log.i(TAG, "yt-dlp atualizado. Status: $status | Versão: ${YoutubeDL.getInstance().versionName(app)}")
      } catch (error: Throwable) {
        // Sem internet/atualização indisponível: segue com a versão instalada (e tenta de novo na próxima vez).
        updateAttempted = false
        Log.w(TAG, "Não foi possível atualizar o yt-dlp. Usando a versão instalada.", error)
      }
    }
  }
}