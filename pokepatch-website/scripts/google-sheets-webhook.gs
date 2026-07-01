/**
 * PokePatch -> Google Sheets webhook (Google Apps Script)
 *
 * Receives POSTs from the Supabase Edge Function "notify" and appends a row.
 *
 * IMPORTANT: Open this script from your Sheet (Extensions -> Apps Script) so it
 * is bound to the spreadsheet. Standalone scripts crash on getActiveSpreadsheet().
 *
 * SETUP
 * 1. Open your Google Sheet -> Extensions -> Apps Script. Paste this file.
 * 2. Set SHARED_SECRET (must match Supabase SHEETS_SECRET).
 * 3. Deploy -> New deployment -> Web app:
 *      Execute as: Me | Who has access: Anyone
 *    Copy the /exec URL into Supabase SHEETS_WEBHOOK_URL.
 */

const SHARED_SECRET = "CHANGE_ME_TO_A_LONG_RANDOM_STRING";
const SHEET_NAME = "Requests";

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return json_({ ok: false, error: "missing body" }, 400);
    }

    const body = JSON.parse(e.postData.contents);

    if (SHARED_SECRET && body.secret !== SHARED_SECRET) {
      return json_({ ok: false, error: "unauthorized" }, 401);
    }

    const record = body.record || {};
    const photos = Array.isArray(body.photos) ? body.photos : [];

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) {
      return json_(
        {
          ok: false,
          error:
            "No spreadsheet bound. Open this script from Extensions -> Apps Script on your Sheet.",
        },
        500
      );
    }

    const sheet = getSheet_(ss);
    ensureHeaders_(sheet);

    const row = [
      record.created_at || new Date().toISOString(),
      record.id != null ? record.id : "",
      record.delivery || "",
      truncate_(record.contact, 5000),
      truncate_(record.restoration_details, 5000),
      photos.length,
      record.folder_id || "",
      "", // Photo links — set as rich text below (clickable, no HYPERLINK formula)
    ];

    sheet.appendRow(row);

    if (photos.length > 0) {
      const lastRow = sheet.getLastRow();
      sheet
        .getRange(lastRow, 8)
        .setRichTextValue(buildPhotoLinksRichText_(photos));
    }

    return json_({ ok: true });
  } catch (err) {
    return json_({ ok: false, error: String(err) }, 500);
  }
}

function getSheet_(ss) {
  return ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
}

function ensureHeaders_(sheet) {
  if (sheet.getLastRow() > 0) return;
  sheet.appendRow([
    "Timestamp",
    "Request ID",
    "Delivery",
    "Contact",
    "Details",
    "# Photos",
    "Storage Folder ID",
    "Photo Links",
  ]);
}

function truncate_(value, max) {
  const text = String(value ?? "");
  return text.length > max ? text.slice(0, max) + "…" : text;
}

/** Clickable links via RichText — works with long signed URLs (unlike HYPERLINK()). */
function buildPhotoLinksRichText_(photos) {
  let text = "";
  const linkRanges = [];

  photos.forEach(function (photo, i) {
    const url = String(photo);
    if (i > 0) text += "\n";
    const prefix = "Photo " + (i + 1) + ": ";
    const urlStart = text.length + prefix.length;
    text += prefix + url;
    linkRanges.push({ start: urlStart, end: urlStart + url.length, url: url });
  });

  const builder = SpreadsheetApp.newRichTextValue().setText(text);
  linkRanges.forEach(function (range) {
    builder.setLinkUrl(range.start, range.end, range.url);
  });
  return builder.build();
}

function json_(obj, status) {
  const output = ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
  // Apps Script ContentService has no status codes; include in body for callers.
  if (status && status >= 400) {
    output.setContent(JSON.stringify({ ...obj, httpStatus: status }));
  }
  return output;
}
