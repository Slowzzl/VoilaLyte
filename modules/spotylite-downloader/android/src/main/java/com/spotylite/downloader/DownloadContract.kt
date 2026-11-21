package com.spotylite.downloader

import android.content.Context
import android.content.Intent
import androidx.work.Data

internal object DownloadContract {
  const val ACTION_EVENT = "com.spotylite.downloader.EVENT"
  const val KEY_ID = "download_id"
  const val KEY_URL = "download_url"
  const val KEY_DIRECTORY = "output_directory"
  const val KEY_STATUS = "status"
  const val KEY_PROGRESS = "progress"
  const val KEY_ERROR = "error"
  const val KEY_FILE_NAME = "file_name"
  const val KEY_TITLE = "title"
  const val KEY_ARTIST = "artist"
  const val KEY_ALBUM = "album"
  const val KEY_COVER = "cover_url"
  const val KEY_DURATION = "duration_ms"

  fun send(context: Context, values: Map<String, Any?>) {
    val intent = Intent(ACTION_EVENT).setPackage(context.packageName)
    values.forEach { (key, value) ->
      when (value) {
        null -> Unit
        is String -> intent.putExtra(key, value)
        is Int -> intent.putExtra(key, value)
        is Long -> intent.putExtra(key, value)
        is Float -> intent.putExtra(key, value)
        is Double -> intent.putExtra(key, value.toFloat())
        is Boolean -> intent.putExtra(key, value)
      }
    }
    context.sendBroadcast(intent)
  }

  fun input(id: String, url: String, directory: String): Data = Data.Builder()
    .putString(KEY_ID, id)
    .putString(KEY_URL, url)
    .putString(KEY_DIRECTORY, directory)
    .build()
}
