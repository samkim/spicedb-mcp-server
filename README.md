# SpiceDB MCP Server

> [!CAUTION]
> This is an experimental MCP server. This is only intended for educational purposes so use at your own risk.

A Model Context Protocol (MCP) server that connects to [SpiceDB](https://authzed.com/spicedb) via its HTTP API for permission management. This server enables LLMs like Claude to interact with your SpiceDB instance to query, manage, and understand your permission system.

## Features

- **Resources**:
  - Schema retrieval with associated object definition resources
  - Relationship queries with interactive relationship resources
  - Object definitions with detailed type information

- **Tools**:
  - Read schema with object definition resources
  - Read relationships with relationship resources
  - Check permissions with detailed authorization traces and explanations
  - Look up resources by subject with permission context
  - Look up subjects by resource with permission details
  - Write relationships with validation

## Prerequisites

- Node.js 16+
- SpiceDB instance
- SpiceDB API key

## Installation

1. Clone this repository:
   ```bash
   git clone https://github.com/authzed/spicedb-mcp-server.git
   cd spicedb-mcp-server
   ```

2. Install dependencies:
   ```bash
   npm install
   # or
   yarn install
   ```

3. Configure your environment:

   Create a `.env` file with your SpiceDB connection details:
   ```
   # SpiceDB HTTP API endpoint (the default port for HTTP API is typically 8443)
   SPICEDB_ENDPOINT=http://localhost:8443
   # or for TLS: https://spicedb.example.com

   SPICEDB_API_KEY=your-api-key-here
   SPICEDB_USE_TLS=false
   ```

4. Build the server:
   ```bash
   npm run build
   # or
   yarn build
   ```

## Usage

### Running Directly

Run the server from the command line:

```bash
node build/index.js
# or
npm start
# or
yarn start
```

### Integrating with Claude for Desktop

1. Edit your Claude for Desktop configuration file:

   **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`

   **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

2. Add the SpiceDB MCP server to the `mcpServers` section:

```json
{
  "mcpServers": {
    "spicedb": {
      "command": "node",
      "args": [
        "/path/to/spicedb-mcp-server/build/index.js"
      ],
      "env": {
        "SPICEDB_ENDPOINT": "http://localhost:8443",
        "SPICEDB_API_KEY": "your-api-key-here",
        "SPICEDB_USE_TLS": "false"
      }
    }
  }
}
```

3. Restart Claude for Desktop

4. View logs for Claude Desktop and SpiceDB MCP

   **macOS**: `/Users/<your username>/Library/Logs/Claude/mcp-server-spicedb.log` and `/Users/<your username>/Library/Logs/Claude/mcp.log`


## Examples

> [!NOTE]
> A SpiceDB instance with a schema and relationship data should be running with the flag `--http-enabled`

### Example Commands for Claude

#### Check a permission:

"Does user:alice have the permission view on document:report1?"

#### Find all resources a subject can access:

"What documents can user:bob read?"

#### Find all subjects that can access a resource:

"Who has edit permission on project:website?"

#### Analyze schema:

"Can you explain the permission system schema?"

#### Setup test scenarios

"Setup the following scenario by writing the appropriate relationships: there is a new role "auditor" and user jared has that role"

#### Preview compliance operations

"The project pied_piper is now deprecated. Find all users who have some form of access to it and create a comprehensive list of users and their access"

## API Reference

### Resources

- `spicedb://schema` - Get the current schema, returns both schema text and object definition resources
- `spicedb://relationships/{resourceType?}/{resourceId?}/{relation?}/{subjectType?}/{subjectId?}/{subjectRelation?}` - Query relationships with optional filters
- `spicedb://definition/{objectType}` - Get detailed definition for a specific object type

### Tools

- `read-schema` - Retrieves the current schema with object definition resources
- `read-relationships` - Queries relationships based on filter parameters, returns both text output and relationship resources
- `check-permission` - Checks if a subject has a specific permission on a resource with debug tracing and explanations of the authorization decision
- `lookup-resources` - Finds resources where a subject has a specific permission, optimized for array response formats
- `lookup-subjects` - Finds subjects with a specific permission on a resource, optimized for array response formats
- `write-relationship` - Creates, updates, or deletes a relationship with validation

### Prompts

- `lookup-resources-for-subject` - Finds resources a subject can access
- `lookup-subjects-for-resource` - Finds subjects that can access a resource
- `explain-permission-check` - Explains a permission check result
- `analyze-schema` - Analyzes the current permission schema

## Relationship Format

Relationships in SpiceDB are formatted as:

```
resourceType:resourceId#relation@subjectType:subjectId[#subjectRelation]
```

This format combines:
- Resource: `resourceType:resourceId` (the object being accessed)
- Relation: `#relation` (the relationship type)
- Subject: `subjectType:subjectId` (the actor accessing the resource)
- Optional subject relation: `#subjectRelation` (for computed subjects)

Examples:
- `document:report#viewer@user:alice` - User alice is a viewer of the report document
- `project:website#admin@group:engineering#member` - Members of the engineering group are admins of the website project
- `resource:promserver#viewer@usergroup:engineering#member` - Members of the engineering user group are viewers of the promserver resource

## MCP Connection Lifecycle

The SpiceDB MCP server implements the full Model Context Protocol connection lifecycle:

1. **Initialization Request**: When a client connects, it sends an `initialize` request containing:
   - Protocol version
   - Client information (name, version)
   - Client capabilities

2. **Server Response**: The server responds with:
   - Protocol version
   - Server information (name, version)
   - Server capabilities (resources, tools, prompts, etc.)

3. **Initialization Confirmation**: The client sends an `initialized` notification to confirm the connection.

4. **Message Exchange**: Normal operation begins with the exchange of requests and responses.

5. **Termination**: When the client disconnects, the server cleans up resources.

The server logs details about this lifecycle to stderr, which you can observe when running the server directly.

### Server Capabilities

This server provides the following capabilities:

- **Resources**: Exposes schema, relationships, and definitions as readable and navigable resources
- **Tools**: Provides tools for interacting with SpiceDB with rich responses including resources
- **Prompts**: Offers template prompts for common permission-related tasks and analysis
- **Debug Tracing**: Includes detailed authorization decision traces and explanations
- **Response Formats**: Support for both legacy and array-based SpiceDB API response formats
- **Logging**: Provides structured logging for troubleshooting and monitoring
