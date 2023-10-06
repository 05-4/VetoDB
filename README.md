# VetoDB Docs
VetoDB is an open sourced SQLite3 wrapper for nodejs. Great for developers needing basic storage requiring the power of SQL, but feel intimidated by the language. VetoDB has some great core features while remaining lightweight.

- Persistent Storage - Data doesn't disappear
- Beginner Friendly - Created for beginners learning about data storage, documentation is straightforward.
- Querying - VetoDB allows basic queries, like matching certain values in columns,

# Installation

You can install VetoDB using npm.
```
npm install vetodb sqlite3 -g
```

# Example

```js
// Import VetoDB library.
const VetoDB = require('vetodb');

// Initialize the client with in-memory storage
// The ":memory:" option tells SQLite to keep the database in RAM
// This is non-persistent; data will be lost when the script ends
const client = VetoDB.Client({ databasePath: ':memory:' });

// Function to create a table and perform various operations
const createUserTable = async () => {
    // Create a new table called 'users' with specified columns
    // If the table already exists, this won't overwrite it
    const users = await client.createTable('users', ['username TEXT', 'email TEXT', 'age INTEGER']);
    console.log('User table created.');

    // Insert a new row into the 'users' table
    const result = await users.insert({ username: 'john_doe', email: 'john@example.com', age: 25 });
    console.log('Insert Result:', result);

    // Insert another row for demo
    await users.insert({ username: 'jane_doe', email: 'jane@example.com', age: 22 });

    // Select rows that match the condition (age = 25)
    const selectedUsers = await users.select({ age: 25 });
    console.log('Selected Users:', selectedUsers);

    // Fetch a single row by its ID
    const user = await users.fetch(1);
    console.log('Fetched User:', user);

    // Update a specific column (age) for a specific row
    if (user) {
        await user.set('age', 26);
        console.log('Age updated to 26.');
    }

    // Delete a row by its ID
    if (user) {
        await user.pop();
        console.log('User removed.');
    }
};

// Run the createUserTable function and catch any errors
createUserTable().catch(err => {
    console.error('Something went wrong:', err);
});
```
