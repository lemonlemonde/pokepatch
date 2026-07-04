/**
 * PokePatch -> Google Sheets webhook for Orders (Google Apps Script)
 *
 * Receives POSTs from the Supabase Edge Function "notify" (orders path)
 * and appends a row to the "Orders" tab.
 *
 * This is a STANDALONE project (script.google.com), separate from the legacy
 * Requests script bound to the spreadsheet via Extensions -> Apps Script.
 * Google only allows one bound script per spreadsheet, so Orders uses
 * SPREADSHEET_ID + openById instead of getActiveSpreadsheet().
 *
 * SETUP
 * 1. Open your Google Sheet -> add a tab named "Orders" (optional; script can create it).
 * 2. Copy the spreadsheet ID from the URL:
 *      https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit
 * 3. Go to https://script.google.com -> New project (do NOT open Extensions -> Apps Script,
 *    that is your existing Requests project — leave it alone).
 * 4. Paste this file. Set SHARED_SECRET and SPREADSHEET_ID.
 * 5. Deploy -> New deployment -> Web app:
 *      Execute as: Me | Who has access: Anyone
 *    Copy the /exec URL into Supabase ORDERS_SHEETS_WEBHOOK_URL.
 * 6. Set ORDERS_SHEET_VIEW_URL to the spreadsheet/Orders tab link for Discord.
 */

const SHARED_SECRET = "CHANGE_ME_TO_A_LONG_RANDOM_STRING";
// Spreadsheet ID from the sheet URL (same workbook as the Requests tab is fine).
const SPREADSHEET_ID = "PASTE_SPREADSHEET_ID_HERE";
const SHEET_NAME = "Orders";

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

    if (!SPREADSHEET_ID || SPREADSHEET_ID === "PASTE_SPREADSHEET_ID_HERE") {
      return json_(
        { ok: false, error: "Set SPREADSHEET_ID in the Apps Script project." },
        500
      );
    }

    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    if (!ss) {
      return json_(
        {
          ok: false,
          error:
            "Could not open spreadsheet. Check SPREADSHEET_ID and that this Google account can edit the sheet.",
        },
        500
      );
    }

    const sheet = getSheet_(ss);
    ensureHeaders_(sheet);

    const row = [
      record.created_at || new Date().toISOString(),
      record.id != null ? record.id : "",
      truncate_(record.customer_name, 5000),
      record.delivery || "",
      record.card_count != null ? record.card_count : "",
      truncate_(record.contacts, 5000),
      photos.length,
      record.storage_prefix || "",
      "", // Photo links — set as rich text below
    ];

    sheet.appendRow(row);

    if (photos.length > 0) {
      const lastRow = sheet.getLastRow();
      sheet
        .getRange(lastRow, 9)
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
    "Order ID",
    "Customer",
    "Delivery",
    "Card Count",
    "Contacts",
    "# Photos",
    "Storage Prefix",
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
  if (status && status >= 400) {
    output.setContent(JSON.stringify({ ...obj, httpStatus: status }));
  }
  return output;
}
