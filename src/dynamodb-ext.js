/** dynamodb-ext.js — helpers Pulse's dynamodb.js doesn't have. Kept separate so dynamodb.js stays byte-identical. */
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, DeleteCommand } = require("@aws-sdk/lib-dynamodb");
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });
async function deleteConfigItem(table, pk, sk) { await ddb.send(new DeleteCommand({ TableName: table, Key: { pk, sk } })); }
module.exports = { deleteConfigItem };
