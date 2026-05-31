// Usage:
//   mongosh "mongodb://127.0.0.1:27017/tzl" apps/node/scripts/cleanup-legacy-media-url-messages.mongo.js
//
// Keep DRY_RUN=true first. After checking the printed samples and counters,
// set DRY_RUN=false and run it again to apply the cleanup.

const DRY_RUN = true;
const COLLECTION_NAME = 'message';
const SEGMENT_SEPARATOR = '</fenge>';

const URL_PATTERN = /\bhttps?:\/\/[^\s"'<>]+/i;
const MEDIA_FILE_PATTERN =
  /(?:^|[\s"'(])\S+\.(?:mp3|wav|m4a|aac|ogg|webm)(?:\s+\d+)?(?=$|[\s"')])/i;
const LEGACY_MEDIA_PATH_PATTERN =
  /(?:^|[\s"'(])(?:images\/)?aiDeceased\/[A-Za-z0-9._/-]+\.(?:mp3|wav|m4a|aac|ogg|webm)(?:\s+\d+)?(?=$|[\s"')])/i;
const QUERY_PATTERN =
  /(https?:\/\/|(?:images\/)?aiDeceased\/|\.(?:mp3|wav|m4a|aac|ogg|webm)(?:\s+\d+)?(?:$|\s))/i;

function isUnsafeSegment(value) {
  const content = String(value || '').trim();

  if (!content) {
    return false;
  }

  return (
    URL_PATTERN.test(content) ||
    MEDIA_FILE_PATTERN.test(content) ||
    LEGACY_MEDIA_PATH_PATTERN.test(content)
  );
}

function splitSegments(content) {
  const value = String(content || '').trim();

  if (!value) {
    return [];
  }

  const legacySegments = value
    .split(SEGMENT_SEPARATOR)
    .map(item => item.trim())
    .filter(Boolean);

  return legacySegments.length > 0 ? legacySegments : [value];
}

const collection = db.getCollection(COLLECTION_NAME);
const cursor = collection.find(
  {
    role: 'assistant',
    type: 'text',
    content: {
      $type: 'string',
      $regex: QUERY_PATTERN,
    },
  },
  {
    _id: 1,
    conversationId: 1,
    userId: 1,
    agentId: 1,
    content: 1,
  }
);

let scanned = 0;
let updated = 0;
let deleted = 0;
const samples = [];

cursor.forEach(doc => {
  scanned += 1;

  const segments = splitSegments(doc.content);
  const keptSegments = segments.filter(segment => !isUnsafeSegment(segment));

  if (keptSegments.length === segments.length) {
    return;
  }

  const before = doc.content;
  const after = keptSegments.join(SEGMENT_SEPARATOR);

  if (samples.length < 10) {
    samples.push({
      _id: doc._id,
      conversationId: doc.conversationId,
      before,
      after: after || null,
      action: after ? 'update' : 'delete',
    });
  }

  if (!after) {
    deleted += 1;

    if (!DRY_RUN) {
      collection.deleteOne({ _id: doc._id });
    }

    return;
  }

  updated += 1;

  if (!DRY_RUN) {
    collection.updateOne(
      { _id: doc._id },
      {
        $set: {
          content: after,
          updatedAt: new Date(),
        },
      }
    );
  }
});

printjson({
  dryRun: DRY_RUN,
  collection: COLLECTION_NAME,
  scanned,
  updated,
  deleted,
  samples,
});
