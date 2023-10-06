const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const { promisify } = require('util');

function writeLogs(data) {
    let logs = require('./log/latest.json');
    for (const key of Object.keys(data)) {
        logs[key] = data[key];
    }

    fs.writeFileSync('./log/latest.json', JSON.stringify(logs, null, 4));
}

class VetoDBError extends Error {
    constructor(data) {
        super(`VetoDB Error: ${data}`);
    }
}

function error(data) {
    throw new VetoDBError(data);
}

function warn(data) {
    console.warn(`  \x1b[33m ⓘ  ${data}\x1b[0m`);
}

class VetoDB {
    /**
        * Creates and returns a new VetoClient.
        * @param {Object} config - Configuration options for the client.
        * @param {string} [config.databasePath] - The path to the SQLite database. Defaults to in-memory database.
        * @param {boolean} [config.disableWarnings=false] - Whether to disable warnings.
        * @returns {VetoClient} - A new VetoClient instance.
        * @static
    */
    static Client(config) {
        return new VetoClient(config);
    }
}

class VetoClient {
    constructor(config) {
        let { databasePath, disableWarnings } = config || {};

        if (!databasePath) {
            databasePath = ":memory:";
            if (!disableWarnings) warn("No database path provided, database is non-persistent and will be stored in memory. To disable this warning, pass { disableWarnings: true } in the config object.");
        } else {
            writeLogs({ database_path: databasePath });
        }

        this.db = new sqlite3.Database(databasePath);
        this.run = promisify(this.db.run).bind(this.db);
    }

    /**
        * Creates a new table.
        * @param {string} name - The name of the table.
        * @param {Array<string>} columns - An array of columns.
        * @returns {Promise<VetoTable>} - A Promise that resolves with the new VetoTable instance.
        * @throws {VetoDBError} - Throws error if the table creation parameters are invalid.
    */
    async createTable(name, columns) {
        if (!name) error("No table name provided");
        if (!columns) error("No columns provided");
        if (!Array.isArray(columns)) error("Columns must be an array");
        if (columns.length < 1) error("Columns must have at least one column");

        const query = `CREATE TABLE IF NOT EXISTS ${name} (_id INTEGER PRIMARY KEY AUTOINCREMENT, ${columns.join(', ')})`;
        await this.run(query);
        return new VetoTable(this.db, name, columns);
    }
}

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
        * @returns {Promise<Object>} - A Promise that resolves with the inserted data.
        * @throws {VetoDBError} - Throws an error if the data is invalid.
    */
    async insert(data) {
        if (!data) error("No data provided");
        if (typeof data !== "object") error("Data must be an object");
        if (Object.keys(data).length < 1) error("Empty object provided");

        const keys = Object.keys(data).join(", ");
        const placeholders = Object.keys(data).map(() => "?").join(", ");
        const values = Object.values(data);

        const query = `INSERT INTO ${this.name} (${keys}) VALUES (${placeholders})`;
        await this.run(query, values);

        return { success: true, data };
    }

    /**
        * Select rows from the table using a query object.
        * @param {Object} query - The data to insert.
        * @returns {Promise<Object>} - A Promise that resolves with the inserted data.
        * @throws {VetoDBError} - Throws an error if the query object is invalid.
    */
    async select(queryObj) {
        if (!queryObj) error("No query provided");
        if (typeof queryObj !== "object") error("Query must be an object");
        if (Object.keys(queryObj).length < 1) error("Empty query provided");

        const conditions = Object.keys(queryObj).map(key => `${key} = ?`).join(" AND ");
        const values = Object.values(queryObj);

        const query = `SELECT * FROM ${this.name} WHERE ${conditions}`;
        const rows = await this.all(query, values);

        return rows.map(row => new DatabaseRow(row, row._id, this));
    }

    /**
        * Fetches a single row from the table using an ID.
        * @param {String} id - The data to insert.
        * @returns {Promise<Object>} - A Promise that resolves with the inserted data.
        * @throws {VetoDBError} - Throws an error if a parameter is invalid.
    */
    async fetch(id) {
        if (!id) error("No ID provided");

        const query = `SELECT * FROM ${this.name} WHERE _id = ?`;
        const row = await this.get(query, [id]);

        if (!row) return null;

        return new DatabaseRow(row, row._id, this);
    }
}

class DatabaseRow {
    constructor(data, id, table) {
        this.data = data;
        this.id = id;
        this.table = table;
    }

    /**
        * [DEPRECATED] Extends the row with a new column value. This does not create a new column, it only sets the value.
        * @param {String} column - The column to extend.
        * @param {String} value - The value to set.
        * @returns {Promise<Object>} - A Promise that resolves with a boolean.
        * @throws {VetoDBError} - Throws an error if a parameter is invalid.
    */
    async extend(column, value) {
        warn("Row.extend() is deprecated and will be removed in a future version. Use Row.set() instead.");
        if (!column) error("No column provided");
        if (!value) error("No value provided");
        if (typeof column !== "string") error("Column must be a string");
        if (typeof value !== "string") error("Value must be a string");
        if (!this.table.columns.includes(column)) error("Column does not exist");
        if (this.data[column] !== null) error("Column already has a value");

        const query = `UPDATE ${this.table.name} SET ${column} = ? WHERE _id = ?`;
        await this.table.run(query, [value, this.id]);

        this.data[column] = value;
        return true;
    }

    /**
        * Deletes the row.
        * @returns {Boolean} - Returns true if the row was deleted.
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
        * @returns {Promise<Object>} - A Promise that resolves with a boolean.
        * @throws {VetoDBError} - Throws an error if a parameter is invalid.
    */
    async set(column, value) {
        if (!column) error("No column provided");
        if (!value) error("No value provided");
        if (typeof column !== "string") error("Column must be a string");
        if (!this.table.columns.includes(column)) error("Column does not exist");

        const query = `UPDATE ${this.table.name} SET ${column} = ? WHERE _id = ?`;
        await this.table.run(query, [value, this.id]);
        this.data[column] = value;
        return true;
    }
}

module.exports = VetoDB;
