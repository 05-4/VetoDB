// Imports
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const { promisify } = require('util');

// Error Handling
class VetoSQLError extends Error {
    constructor(code, data) {
        super(`VetoSQL Error: ${code}: ${data}`);
    }
}

function error(code, data)  {
    throw new VetoSQLError(code, data);
}

function warn(data) {
    console.warn(`\t\x1b[33mVetoSQL Warning:\x1b[0m ${data}`);
}

// Classes
class VetoClient {
    /**
        * Creates and returns a new VetoClient.
        * @param {Object} config - Configuration options for the client.
        * @param {string} [config.databasePath] - The path to the SQLite database. Defaults to in-memory database.
        * @param {boolean} [config.disableWarnings=false] - Whether to disable warnings.
        * @param {boolean} [config.rawDatabase=false] - Disable input sanitization. (Only use for testing)
        * @returns {VetoClient} - A new VetoClient instance.
        * @static
    */
    constructor(config) {
        let { databasePath=":memory:", disableWarnings=false, rawDatabase=false } = config || {};

        if (rawDatabase && !disableWarnings) warn("Option 'rawDatabase' is enabled, leaving database vulnerable to SQL injection attacks. To disable this warning, pass { disableWarnings: true } in the config object.")
        if (databasePath === ":memory:" && !disableWarnings) warn("No database path provided, database is non-persistent and will be stored in memory. To disable this warning, pass { disableWarnings: true } in the config object.")

        this.db = new sqlite3.Database(databasePath);
        this.run = promisify(this.db.run).bind(this.db);
    }

    /**
        * Creates a new table.
        * @param {string} name - The name of the table.
        * @param {Array<string>} columns - An array of columns.
        * @returns {Promise<VetoTable>} - A Promise that resolves with the new VetoTable instance.
        * @throws {VetoSQLError} - Throws error if the table creation parameters are invalid.
    */
    async createTable(name, columns) {
        if (!name) error(150, "No table name provided");
        if (!columns) error(151, "No columns provided");
        if (!Array.isArray(columns)) error(152, "Columns must be an array");
        if (columns.length < 1) error(153, "Columns must have at least one column");
        
        for (let column of columns) {
            if (/[^A-Za-z0-9]/g.test(column)) error(154, "One or more columns contain forbidden characters. Expression: 'A-Za-z0-9'");
        }

        const query = `CREATE TABLE IF NOT EXISTS ${name} (_id INTEGER PRIMARY KEY AUTOINCREMENT, ${columns.join(', ')})`;
        await this.run(query);
        return new VetoTable(this.db, name, columns);
    }
}

class VetoSQL { static client = VetoClient }
class VetoTable {
    constructor(db, name, columns) {
        this.db = db;
        this.name = name;
        this.columns = columns;
        this.run = promisify(this.db.run).bind(this.db);
        this.all = promisify(this.db.all).bind(this.db);
        this.get = promisify(this.db.get).bind(this.db);
    }

    /**
        * Drops the table.
        * @returns {Promise<VetoTable>} - A Promise that resolves with the dropped table.
    */
    async drop() {
        const query = `DROP TABLE IF EXISTS ${this.name}`;
        await this.run(query);
        return this;
    }

    /**
        * Inserts data into the table.
        * @param {Object} data - The data to insert.
        * @returns {Promise<{ success: boolean, data: any }>} - A Promise that resolves with the inserted data.
        * @throws {VetoSQLError} - Throws an error if the data is invalid.
    */
    async insert(data) {
        if (!data) error(155, "No data provided");
        if (typeof data !== "object") error(156, "Data must be an object");
        if (Object.keys(data).length < 1) error(157, "Empty object provided");

        const keys = Object.keys(data).join(", ");
        const placeholders = Object.keys(data).map(() => "?").join(", ");
        const values = Object.values(data);

        const query = `INSERT INTO ${this.name} (${keys}) VALUES (${placeholders})`;
        await this.run(query, values);

        return { success: true, data };
    }

    /**
        * Removes row from table.
        * @param {Number} id - The data to insert.
        * @returns {Promise<undefined>} - A Promise that resolves with the inserted data.
        * @throws {VetoSQLError} - Throws an error if the data is invalid.
    */
    async remove(id) {
        const query = `DELETE FROM ${this.name} WHERE _id = ?`;
        await this.table.run(query, [ id ]);
    }

    /**
        * Select rows from the table using a query object.
        * @param {Object} query - The data to insert.
        * @returns {Promise<DatabaseRow[]>} - A Promise that resolves with the inserted data.
        * @throws {VetoSQLError} - Throws an error if the query object is invalid.
    */
    async select(queryObj) {
        if (!queryObj) error(158, "No query provided");
        if (typeof queryObj !== "object") error(159, "Query must be an object");
        if (Object.keys(queryObj).length < 1) error(160, "Empty query provided");

        const conditions = Object.keys(queryObj).map(key => `${key} = ?`).join(" AND ");
        const values = Object.values(queryObj);

        const query = `SELECT * FROM ${this.name} WHERE ${conditions}`;
        const rows = await this.all(query, values);

        return rows.map(row => new DatabaseRow(row, row._id, this));
    }

    /**
        * Fetches a single row from the table using an ID.
        * @param {String} id - The data to insert.
        * @returns {Promise<DatabaseRow>} - A Promise that resolves with the inserted data.
        * @throws {VetoSQLError} - Throws an error if a parameter is invalid.
    */
    async fetch(id) {
        if (!id) error(161, "No ID provided");

        const query = `SELECT * FROM ${this.name} WHERE _id = ?`;
        const row = await this.get(query, [id]);

        if (!row) return null;

        return new DatabaseRow(row, row._id, this);
    }

    /**
        * Create a transaction.
        * @param {DatabaseRow|Number} sender - Transferring row/id.
        * @param {DatabaseRow|Number} receiver - Receiving row/id.
        * @param {String} column - Column to transfer from.
        * @param {Number} amount - The amount to transfer.
        * @param {Number} min - The minimum value required in column.
        * @returns {Promise<Boolean>} - Boolean stating success.
        * @throws {VetoSQLError} - Throws an error if the data is invalid.
    */
    async transaction(sender, receiver, column, amount, min) {
        if (typeof sender === "number" || typeof sender === "string") sender = await this.fetch(sender);
        if (typeof receiver === "number" || typeof receiver === "string") receiver = await this.fetch(receiver);

        const senderBalance = parseFloat(sender.data[column]);
        const receiverBalance = parseFloat(receiver.data[column]);

        if (isNaN(senderBalance) || isNaN(receiverBalance)) error(161, "Data is NaN, expected type 'float' or 'integer'");
        if (senderBalance < amount || senderBalance < min) return false;
        await sender.set(senderBalance - amount);
        await receiver.set(receiverBalance + amount);

        return true;
    }
}

class DatabaseRow {
    constructor(data, id, table) {
        /**
            * Object of row data.
            * @type {Object} - An object of all columns in row
        */
        this.data = data;
        this.id = id;
        this.table = table;
    }

    /**
        * Deletes the row.
        * @returns {Promise<Boolean>} - Returns true if successful
    */
    async pop() {
        const query = `DELETE FROM ${this.table.name} WHERE _id = ?`;
        await this.table.run(query, [this.id]);
        return true;
    }

    /**
        * Sets a column's value.
        * @param {String} column - The column to set.
        * @param {String} value - The value to set.
        * @returns {Promise<Boolean>} - Returns true if successful.
        * @throws {VetoSQLError} - Throws an error if a parameter is invalid.
    */
    async set(column, value) {
        if (!column) error(162, "No column provided");
        if (!value) error(163, "No value provided");
        if (typeof column !== "string") error(164, "Column must be a string");
        if (!this.table.columns.includes(column)) error(165, "Column does not exist");

        const query = `UPDATE ${this.table.name} SET ${column} = ? WHERE _id = ?`;
        await this.table.run(query, [value, this.id]);
        this.data[column] = value;
        return true;
    }
}

module.exports = VetoSQL;
