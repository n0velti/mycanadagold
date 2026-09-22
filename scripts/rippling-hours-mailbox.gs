/**
 * Stays signed in as the hours inbox and posts the newest CSV attachment to
 * the app. Install once from the Apps Script editor:
 *
 *   Script properties: MAILBOX_ENDPOINT, MAILBOX_SECRET
 *   Run install() and approve Gmail + external requests.
 *
 * install() creates a trigger that calls syncRipplingCsv every 5 minutes.
 * The newest message with a CSV replaces whatever the Rippling screen shows.
 */
function install() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i += 1) {
    if (triggers[i].getHandlerFunction() === 'syncRipplingCsv') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  ScriptApp.newTrigger('syncRipplingCsv').timeBased().everyMinutes(5).create();
  syncRipplingCsv();
}

function syncRipplingCsv() {
  var props = PropertiesService.getScriptProperties();
  var secret = props.getProperty('MAILBOX_SECRET');
  var endpoint = props.getProperty('MAILBOX_ENDPOINT');
  if (!secret || !endpoint) throw new Error('Set MAILBOX_SECRET and MAILBOX_ENDPOINT in script properties.');

  var queries = [
    'newer_than:21d filename:csv',
    'newer_than:21d subject:Scheduled subject:Report',
    'newer_than:21d from:rippling has:attachment',
  ];
  var seen = {};
  var threads = [];
  for (var q = 0; q < queries.length; q += 1) {
    var found = GmailApp.search(queries[q], 0, 15);
    for (var t = 0; t < found.length; t += 1) {
      var threadId = found[t].getId();
      if (seen[threadId]) continue;
      seen[threadId] = true;
      threads.push(found[t]);
    }
  }
  var best = null;
  for (var i = 0; i < threads.length; i += 1) {
    var messages = threads[i].getMessages();
    for (var j = 0; j < messages.length; j += 1) {
      var message = messages[j];
      var attachments = message.getAttachments();
      var files = [];
      for (var k = 0; k < attachments.length; k += 1) {
        var att = attachments[k];
        var name = String(att.getName() || '');
        var type = String(att.getContentType() || '').toLowerCase();
        var isCsv = /\.csv$/i.test(name) || type.indexOf('csv') >= 0 || type.indexOf('comma-separated') >= 0;
        if (!isCsv && /octet-stream|excel|spreadsheet/.test(type) && /\.csv$/i.test(name)) isCsv = true;
        if (!isCsv) continue;
        files.push({ name: name || 'report.csv', csv: att.getDataAsString() });
      }
      if (!files.length) continue;
      var when = message.getDate().getTime();
      if (!best || when > best.receivedAt) {
        best = {
          messageId: String(message.getId()),
          subject: String(message.getSubject() || ''),
          from: String(message.getFrom() || ''),
          receivedAt: when,
          files: files,
        };
      }
    }
  }
  if (!best) return;
  if (props.getProperty('LAST_MESSAGE_ID') === best.messageId) return;

  var response = UrlFetchApp.fetch(endpoint, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-rippling-mailbox-secret': secret },
    payload: JSON.stringify({
      messageId: best.messageId,
      subject: best.subject,
      from: best.from,
      receivedAt: new Date(best.receivedAt).toISOString(),
      files: best.files,
    }),
    muteHttpExceptions: true,
  });
  var code = response.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error('Mailbox push failed: ' + code + ' ' + response.getContentText().slice(0, 300));
  }
  props.setProperty('LAST_MESSAGE_ID', best.messageId);
}
