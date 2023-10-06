#!/usr/bin/env node

const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

function writeLogs(data) {
    let logs = require('../log/latest.json');
    for (const key of Object.keys(data)) {
        logs[key] = data[key];
    }

    const rootDir = path.resolve(__dirname, '../');
    fs.writeFileSync(path.join(rootDir, '/log/latest.json'), JSON.stringify(logs, null, 4), {  });
}

function errorHighlight(header, text, extras = []) {
    let output = `\n  \x1b[31m✗  ${header}:\x1b[30m ${text}\x1b[0m`;
    
    if (extras.length > 0) output += "\n";

    for (const extra of extras) {
        output += extra.header ? `\n\x1b[34m${extra.header}: \x1b[0m${extra.text}` : `\n${extra.text}`;
    }

    return output + "\n";
}

function error(...data) {
    console.log(errorHighlight(...data));
    process.exit(1);
}

const runAsync = (db, query) => new Promise((resolve, reject) => {
    db.run(query, function (err) {
        if (err) reject(err);
        else resolve(this);
    });
});

const allAsync = (db, query) => new Promise((resolve, reject) => {
    db.all(query, [], (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
    });
});

function toString(v) {
    let out;

    if (v === null || v === undefined) out = "NULL";
    else if (typeof v === "string") out = `'${v}'`;
    else out = v.toString();

    return out;
}

async function backup_db(file, folder) {
    if (!file || !folder) {
        error("Missing Arguments", "Both file and folder parameters must be provided.");
    }

    const backupFile = path.join(folder, `${Date.now()}_backup.db`);

    const originalDb = new sqlite3.Database(file);
    const backupDb = new sqlite3.Database(backupFile);

    const startTime = Date.now();

    try {
        const tables = await allAsync(originalDb, "SELECT name FROM sqlite_master WHERE type='table'");

        if (tables.length === 0) {
            return "No tables available for backup.";
        }

        for (const { name: tableName } of tables) {
            if (tableName === "sqlite_sequence") continue;
            const schema = await allAsync(originalDb, `PRAGMA table_info(${tableName})`);
            
            if (schema.length === 0) {
                error("SQL Execution Error", `The table ${tableName} doesn't bloody exist in the original database.`);
                continue;
            }
        
            const columns = schema.map(column => `${column.name} ${column.type}`).join(', ');
            await runAsync(backupDb, `CREATE TABLE IF NOT EXISTS ${tableName} (${columns})`);
        
            const data = await allAsync(originalDb, `SELECT * FROM ${tableName}`);
        
            for (const row of data) {
                const keys = Object.keys(row).join(", ");
                const values = Object.values(row).map(value => (toString(value))).join(", ");
                await runAsync(backupDb, `INSERT INTO ${tableName} (${keys}) VALUES (${values})`);
            }
        }

        const endTime = Date.now();
        const duration = (endTime - startTime);

        writeLogs({ latest_backup: backupFile });

        return duration;
    } catch (err) {
        error("SQL Execution Error", "An error occurred during SQL execution.", [{ header: err.message.split(": ")[0], text: err.message.split(": ").slice(1).join(": ") }]);
    }
}

async function restore_db(file, backup) {
    if (!file || !backup) {
        error("Missing Arguments", "Both file and backup parameters must be provided.");
    }

    const originalDb = new sqlite3.Database(file);
    const backupDb = new sqlite3.Database(backup);

    const startTime = Date.now();

    try {
        const tables = await allAsync(backupDb, "SELECT name FROM sqlite_master WHERE type='table'");

        if (tables.length === 0) {
            return "No tables available for backup.";
        }

        for (const { name: tableName } of tables) {
            if (tableName === "sqlite_sequence") continue;
            const schema = await allAsync(backupDb, `PRAGMA table_info(${tableName})`);
            
            if (schema.length === 0) {
                error("SQL Execution Error", `The table ${tableName} doesn't bloody exist in the original database.`);
                continue;
            }
        
            const columns = schema.map(column => `${column.name} ${column.type}`).join(', ');
            await runAsync(originalDb, `CREATE TABLE IF NOT EXISTS ${tableName} (${columns})`);
        
            const data = await allAsync(backupDb, `SELECT * FROM ${tableName}`);
        
            for (const row of data) {
                if (row?._id) delete row._id;

                const keys = Object.keys(row).join(", ");
                const values = Object.values(row).map(value => (toString(value))).join(", ");
                await runAsync(originalDb, `INSERT INTO ${tableName} (${keys}) VALUES (${values})`);
            }
        }

        const endTime = Date.now();
        const duration = (endTime - startTime);

        return duration;
    } catch (err) {
        error("SQL Execution Error", "An error occurred during SQL execution.", [{ header: err.message.split(": ")[0], text: err.message.split(": ").slice(1).join(": ") }]);
    }
}

function fetchLatestFile() {
    const logs = require('../log/latest.json');
    if (!logs || !logs?.database_path) error("StorageError", "Database path can't automatically be fetched, please provide a path manually", [ {
        header: "Fix 1",
        text: "Run 'veto backup -file <file_path>' to create a backup."
    }, {
        header: "Fix 2",
        text: "Access your database programmatically, this'll store your database path for backups."
    } ])
    return logs.database_path;
}

function createBackupFolder() {
    if (!fs.existsSync(path.join(process.env.LOCALAPPDATA, "vetodb"))) {
        fs.mkdirSync(path.join(process.env.LOCALAPPDATA, "vetodb"));
    }

    if (!fs.existsSync(path.join(process.env.LOCALAPPDATA, "vetodb", "backups"))) {
        fs.mkdirSync(path.join(process.env.LOCALAPPDATA, "vetodb", "backups"));
    }

    return path.join(process.env.LOCALAPPDATA, "vetodb", "backups");
}

async function main() {
    const args = process.argv.slice(2);

    if (args.length < 1) {
        error("InputError", "No command provided", [{ header: "Usage", text: "vetodb <command>" }]);
        return;
    }

    const command = args[0];

    switch (command) {
        case "backup":
            let folder = createBackupFolder();
            let file;

            if (args[1] && args[1].startsWith("-file")) {
                if (args.slice(2).length < 1) error("InputError", "No file provided", [{ header: "Usage", text: "veto backup -file <file>" }]);

                file = args.slice(2).join(" ");
            }

            file = file ? file : fetchLatestFile();

            const duration = await backup_db(file, folder);

            console.log(`\n  \x1b[34m✓\x1b[0m  Backup completed in \x1b[34m${duration}ms\x1b[0m.\n\nBackup saved to \x1b[30m${path.join(folder, `${Date.now()}_backup.db`)}\x1b[0m.\n`);
            break;
        case "restore":
            const logs = require('../log/latest.json');
            if (!logs || !logs?.latest_backup) error("StorageError", "No latest backup found, please create a backup first");

            const backup = logs.latest_backup;
            const db = fetchLatestFile();

            const restoreDuration = await restore_db(db, backup);

            console.log(`\n  \x1b[34m✓\x1b[0m  Restore completed in \x1b[34m${restoreDuration}ms\x1b[0m.\n\nRestored from \x1b[30m${backup}\x1b[0m.\n`);
            break;
        default:
            error("Unknown Command", command ?? "undefined");
            break;
    }
}

main();
