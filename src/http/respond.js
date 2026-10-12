// ファイル・CSVの応答。ファイル名は ASCII のみ(Content-Disposition を単純に保つため)。

function attachmentHeaders(contentType, filename, length) {
  return {
    'Content-Type': contentType,
    'Content-Length': length,
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  };
}

export function sendCsv(res, filename, csvText) {
  const body = Buffer.from(csvText, 'utf8');
  res.writeHead(200, attachmentHeaders('text/csv; charset=utf-8', filename, body.length));
  res.end(body);
}

export function sendFileBuffer(res, contentType, filename, buffer) {
  res.writeHead(200, attachmentHeaders(contentType, filename, buffer.length));
  res.end(buffer);
}
