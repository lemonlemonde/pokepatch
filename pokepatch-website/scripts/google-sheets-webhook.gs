/**
 * PokePatch -> Google Sheets webhook (Google Apps Script)
 *
 * Receives POSTs from the Supabase Edge Function "notify" (NOT directly from
 * the database webhook) and appends a row, with clickable signed photo links.
 *
 * Payload shape sent by the Edge Function:
 * {
 *   "secret": "<SHEETS_SECRET>",
 *   "record": {
 *     "id": 17,
 *     "created_at": "...",
 *     "delivery": "Shipping",
 *     "contact": "...",
 *     "restoration_details": "..."
 *   },
 *   "photos": ["https://signed-url-1", "https://signed-url-2"]
 * }
 *
 * SETUP
 * 1. Create a Google Sheet -> Extensions -> Apps Script. Paste this file.
 * 2. Set SHARED_SECRET to a long random string (must match Supabase SHEETS_SECRET).
 * 3. Deploy -> New deployment -> type "Web app":
 *      - Execute as: Me
 *      - Who has access: Anyone
 *    Copy the Web app URL (ends in /exec).
 * 4. That URL goes into the Edge Function secret SHEETS_WEBHOOK_URL (see notify/README.md).
 */

const SHARED_SECRET = "CHANGE_ME_TO_A_LONG_RANDOM_STRING";
const SHEET_NAME = "Requests";

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);

    if (SHARED_SECRET && body.secret !== SHARED_SECRET) {
      return json_({ ok: false, error: "unauthorized" });
    }

    const record = body.record || {};
    const photos = Array.isArray(body.photos) ? body.photos : [];

    const sheet = getSheet_();
    ensureHeaders_(sheet);

    const row = [
      record.created_at || new Date().toISOString(),
      record.id != null ? record.id : "",
      record.delivery || "",
      record.contact || "",
      record.restoration_details || "",
      photos.length,
    ];

    // One clickable link per photo, each in its own column.
    photos.forEach((url, i) => {
      row.push('=HYPERLINK("' + url + '","Photo ' + (i + 1) + '")');
    });

    sheet.appendRow(row);
    return json_({ ok: true });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
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
    "Photos",
  ]);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}
