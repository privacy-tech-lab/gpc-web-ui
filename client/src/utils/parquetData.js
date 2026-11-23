import {
  asyncBufferFromUrl,
  cachedAsyncBuffer,
  parquetMetadataAsync,
  parquetReadObjects,
} from "hyparquet";
import { compressors } from "hyparquet-compressors";

/**
 * Opens a Parquet file over HTTP. Only the footer is fetched up front; column
 * data is fetched with Range requests when you call `readColumns`, so columns
 * you never ask for are never downloaded. (If a server ignores Range requests,
 * hyparquet transparently falls back to downloading the whole file once.)
 *
 * Every column in our files is a STRING, exactly as it appeared in the CSV.
 *
 * @returns {Promise<{ columns: string[], numRows: number,
 *   readColumns: (columns: string[]) => Promise<Record<string, string>[]> }>}
 */
export async function openParquet(url) {
  const file = cachedAsyncBuffer(await asyncBufferFromUrl({ url }));
  const metadata = await parquetMetadataAsync(file);

  // schema[0] is the root; the rest are our (flat) columns, in file order.
  const columns = metadata.schema.slice(1).map((element) => element.name);

  return {
    columns,
    numRows: Number(metadata.num_rows),
    readColumns: (wanted) =>
      parquetReadObjects({ file, metadata, compressors, columns: wanted }),
  };
}
