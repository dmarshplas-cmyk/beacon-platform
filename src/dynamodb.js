/**
 * dynamodb.js — thin data access for the energy platform.
 * AWS SDK v3 is bundled in the nodejs18.x+ Lambda runtimes: no node_modules
 * needed in the zip, same as housing-iaq.
 */

const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  QueryCommand,
  GetCommand,
  PutCommand,
  BatchWriteCommand,
  ScanCommand,
} = require("@aws-sdk/lib-dynamodb");

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

/**
 * All readings for one circuit in [startIso, endIso) — end EXCLUSIVE, so a
 * boundary-timestamp sample can't leak into two adjacent windows.
 * Readings table: pk `circuit_id` (S), sk `ts` (S, ISO-8601).
 * Item: { circuit_id, ts, power_w?, energy_wh? }
 */
async function queryReadings(table, circuitId, startIso, endIsoExclusive) {
  const items = [];
  let lastKey;
  do {
    const res = await ddb.send(new QueryCommand({
      TableName: table,
      // DynamoDB allows only ONE condition on a sort key, so exclusive-end is
      // expressed as BETWEEN with the end bound pulled back 1 ms. All stored ts
      // are millisecond-precision ISO strings (adapters normalise via
      // toISOString), so end-1ms == "strictly before end".
      KeyConditionExpression: "circuit_id = :c AND ts BETWEEN :s AND :e",
      ExpressionAttributeValues: {
        ":c": circuitId,
        ":s": startIso,
        ":e": new Date(Date.parse(endIsoExclusive) - 1).toISOString(),
      },
      ExclusiveStartKey: lastKey,
    }));
    items.push(...(res.Items || []));
    lastKey = res.LastEvaluatedKey;
  } while (lastKey);
  return items;
}

/** Full scan of the config table, optionally filtered by entity_type. */
async function scanConfig(table, entityType = null) {
  const items = [];
  let lastKey;
  do {
    const params = { TableName: table, ExclusiveStartKey: lastKey };
    if (entityType) {
      params.FilterExpression = "entity_type = :t";
      params.ExpressionAttributeValues = { ":t": entityType };
    }
    const res = await ddb.send(new ScanCommand(params));
    items.push(...(res.Items || []));
    lastKey = res.LastEvaluatedKey;
  } while (lastKey);
  return items;
}

/** Rollup items by sk prefix (e.g. weeks history), newest first by default. */
async function queryByPrefix(table, pk, skPrefix, { limit = 12, desc = true } = {}) {
  const res = await ddb.send(new QueryCommand({
    TableName: table,
    KeyConditionExpression: "pk = :p AND begins_with(sk, :s)",
    ExpressionAttributeValues: { ":p": pk, ":s": skPrefix },
    ScanIndexForward: !desc,
    Limit: Math.max(1, Math.min(200, limit)),
  }));
  return res.Items || [];
}

/** One rollup item by exact key. */
async function getRollup(table, pk, sk) {
  const res = await ddb.send(new GetCommand({ TableName: table, Key: { pk, sk } }));
  return res.Item || null;
}

/** Put a single rollup item. */
async function putRollup(table, item) {
  await ddb.send(new PutCommand({ TableName: table, Item: item }));
}

/** Generic batch-put (25 per batch, retries unprocessed). */
async function batchPut(table, items) {
  for (let i = 0; i < items.length; i += 25) {
    let requests = items.slice(i, i + 25).map((Item) => ({ PutRequest: { Item } }));
    let attempts = 0;
    while (requests.length && attempts < 5) {
      const res = await ddb.send(new BatchWriteCommand({
        RequestItems: { [table]: requests },
      }));
      requests = res.UnprocessedItems?.[table] || [];
      if (requests.length) {
        attempts += 1;
        await new Promise((r) => setTimeout(r, 200 * attempts));
      }
    }
    if (requests.length) {
      throw new Error(`batchPut: ${requests.length} items unprocessed after retries`);
    }
  }
}

const batchPutRollups = batchPut; // kept for the rollup handler's existing calls

/** Config item get/put (admin import endpoints). */
async function getConfigItem(table, pk, sk) {
  const res = await ddb.send(new GetCommand({ TableName: table, Key: { pk, sk } }));
  return res.Item || null;
}
async function putConfigItem(table, item) {
  await ddb.send(new PutCommand({ TableName: table, Item: item }));
}

module.exports = {
  queryReadings, scanConfig, queryByPrefix, getRollup, putRollup,
  batchPut, batchPutRollups, getConfigItem, putConfigItem,
};
