#!/usr/bin/env node

import {
  McpServer,
  ResourceTemplate,
} from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { SpiceDBClient } from './spicedb-client.js';
import * as dotenv from 'dotenv';

dotenv.config();

// Logging levels for MCP logging capability
type LogLevel =
  | 'debug'
  | 'info'
  | 'notice'
  | 'warning'
  | 'error'
  | 'critical'
  | 'alert'
  | 'emergency';

// Utility function to log a message - we'll implement this with console.error for now
// since loggingNotification isn't available directly on McpServer
function logMessage(server: McpServer, level: LogLevel, message: string) {
  console.error(`[${level.toUpperCase()}] ${message}`);
}

// Initialize SpiceDB client
const spiceDB = SpiceDBClient.getInstance();

// Helper function to extract object definitions from schema text and create resources
function extractObjectDefinitionsFromSchema(schemaText: string): Array<any> {
  if (!schemaText) return [];

  const objectDefResources = [];
  const lines = schemaText.split('\n');
  let currentDef = '';
  let currentObjectType = '';
  let insideDefinition = false;
  let braceCount = 0;

  // Process each line to find object definitions
  for (const line of lines) {
    const trimmedLine = line.trim();

    // Check if line starts a definition
    if (trimmedLine.startsWith('definition ')) {
      const match = trimmedLine.match(/definition\s+(\w+)\s*{/);
      if (match) {
        insideDefinition = true;
        currentObjectType = match[1];
        currentDef = line + '\n';
        braceCount = 1; // Opening brace
        continue;
      }
    }

    // If we're inside a definition, collect the lines
    if (insideDefinition) {
      currentDef += line + '\n';

      // Count braces to determine when definition ends
      braceCount += (line.match(/{/g) || []).length;
      braceCount -= (line.match(/}/g) || []).length;

      // If braces are balanced, definition is complete
      if (braceCount === 0) {
        objectDefResources.push({
          uri: `spicedb://definition/${currentObjectType}`,
          name: `${currentObjectType} Definition`,
          description: `Object definition for type ${currentObjectType} in the schema`,
        });

        insideDefinition = false;
        currentDef = '';
        currentObjectType = '';
      }
    }
  }

  return objectDefResources;
}

// Helper function to generate a human-readable explanation of the permission check trace
function generateTraceExplanation(trace: any, depth: number): string {
  if (!trace) return 'No trace data available';

  const indent = '  '.repeat(depth);
  let explanation = '';

  // Extract information about the current check
  const resourceStr = `${trace.resource.objectType}:${trace.resource.objectId}`;
  const permissionStr = trace.permission;
  const permissionType =
    trace.permissionType === 'PERMISSION_TYPE_PERMISSION'
      ? 'permission'
      : 'relation';

  const subjectStr = trace.subject.object
    ? `${trace.subject.object.objectType}:${trace.subject.object.objectId}${
        trace.subject.optionalRelation
          ? '#' + trace.subject.optionalRelation
          : ''
      }`
    : 'unknown subject';

  const result = trace.result.replace('PERMISSIONSHIP_', '');

  // Build the explanation for this level
  explanation += `${indent}Checking if ${subjectStr} has ${permissionType} "${permissionStr}" on ${resourceStr}: ${result}\n`;

  // Add information about timing if available
  if (trace.duration) {
    explanation += `${indent}(took ${trace.duration})\n`;
  }

  // Process sub-problems recursively
  if (
    trace.subProblems &&
    trace.subProblems.traces &&
    trace.subProblems.traces.length > 0
  ) {
    explanation += `${indent}This was determined by:\n`;

    for (const subTrace of trace.subProblems.traces) {
      explanation += generateTraceExplanation(subTrace, depth + 1);
    }
  }

  return explanation;
}

async function main() {
  // Create MCP server with explicit capabilities and lists of supported features
  const server = new McpServer(
    {
      name: 'spicedb-mcp',
      version: '1.0.0',
    },
    {
      capabilities: {
        // Resources capability with specific resource types
        resources: {
          resources: [
            {
              uri: 'spicedb://schema',
              name: 'Schema',
              description: 'The current SpiceDB schema',
            },
            {
              uriTemplate:
                'spicedb://relationships/{resourceType?}/{resourceId?}/{relation?}/{subjectType?}/{subjectId?}/{subjectRelation?}',
              name: 'Relationships',
              description: 'Query relationships with optional filters',
            },
            {
              uriTemplate: 'spicedb://definition/{objectType}',
              name: 'Object Definition',
              description: 'Get definition for a specific object type',
            },
          ],
        },

        // Tools capability with list of supported tools
        tools: {
          tools: [
            {
              name: 'read-schema',
              description: 'Get the current SpiceDB schema',
            },
            {
              name: 'read-relationships',
              description: 'Find relationships matching specified filters',
            },
            {
              name: 'check-permission',
              description: 'Check if a subject has a permission on a resource',
            },
            {
              name: 'lookup-resources',
              description: 'Find resources where a subject has a permission',
            },
            {
              name: 'lookup-subjects',
              description: 'Find subjects with permission on a resource',
            },
            {
              name: 'write-relationship',
              description: 'Create, update, or delete a relationship',
            },
          ],
        },

        // Prompts capability with list of supported prompts
        prompts: {
          prompts: [
            {
              name: 'lookup-resources-for-subject',
              description: 'Find resources a subject can access',
            },
            {
              name: 'lookup-subjects-for-resource',
              description: 'Find subjects that can access a resource',
            },
            {
              name: 'explain-permission-check',
              description: 'Explain a permission check result',
            },
            {
              name: 'analyze-schema',
              description: 'Analyze the permission schema structure',
            },
          ],
        },
      },
    }
  );

  console.error('Starting SpiceDB MCP Server...');
  console.error(`Connected to SpiceDB at ${process.env.SPICEDB_ENDPOINT}`);

  // Register resources
  registerResources(server);

  // Register tools
  registerTools(server);

  // Register prompts
  registerPrompts(server);

  // Configure server capabilities
  const transport = new StdioServerTransport();

  // Set up event handlers using the correct property names
  transport.onclose = () => {
    console.error('Client disconnected - cleaning up resources');
  };

  transport.onerror = (error: Error) => {
    console.error(`Transport error: ${error.message}`);
  };

  // Connect the server to the transport
  await server.connect(transport);

  console.error('SpiceDB MCP Server running on stdio');

  // Send a server ready message to the console
  console.error('Server started successfully');
}

function registerResources(server: McpServer) {
  // Schema resource - Get the current schema from SpiceDB
  server.resource('schema', 'spicedb://schema', async (uri) => {
    try {
      const response = (await spiceDB.readSchema({
        consistency: spiceDB.fullConsistency(),
      })) as any;

      return {
        contents: [
          {
            uri: uri.href,
            text: response.schemaText,
            mimeType: 'text/plain',
          },
        ],
      };
    } catch (error) {
      console.error('Error fetching schema:', error);
      return {
        contents: [
          {
            uri: uri.href,
            text: `Error fetching schema: ${error}`,
            mimeType: 'text/plain',
          },
        ],
      };
    }
  });

  // Relationships resource - Get relationships for a specific filter
  server.resource(
    'relationships',
    new ResourceTemplate(
      'spicedb://relationships/{resourceType?}/{resourceId?}/{relation?}/{subjectType?}/{subjectId?}/{subjectRelation?}',
      { list: undefined }
    ),
    async (uri, params) => {
      try {
        const resourceType = params.resourceType as string | undefined;
        const resourceId = params.resourceId as string | undefined;
        const relation = params.relation as string | undefined;
        const subjectType = params.subjectType as string | undefined;
        const subjectId = params.subjectId as string | undefined;
        const subjectRelation = params.subjectRelation as string | undefined;

        const filter = spiceDB.createRelationshipFilter(
          resourceType,
          resourceId,
          relation,
          subjectType,
          subjectId,
          subjectRelation
        );

        // Read relationships matching the filter
        const results = await spiceDB.readRelationships({
          consistency: spiceDB.fullConsistency(),
          relationshipFilter: filter,
        });

        let relationships = '';
        for (const result of results) {
          const rel = (result as any).relationship;
          if (rel) {
            const resource = `${rel.resource.objectType}:${rel.resource.objectId}`;
            const relation = rel.relation;
            const subject = spiceDB.subjectRefToString(rel.subject);

            relationships += `${resource}#${relation}@${subject}\n`;
          }
        }

        return {
          contents: [
            {
              uri: uri.href,
              text: relationships || 'No relationships found',
              mimeType: 'text/plain',
            },
          ],
        };
      } catch (error) {
        console.error('Error fetching relationships:', error);
        return {
          contents: [
            {
              uri: uri.href,
              text: `Error fetching relationships: ${error}`,
              mimeType: 'text/plain',
            },
          ],
        };
      }
    }
  );

  // Object Definition resource - Get object definition from schema
  server.resource(
    'object-definition',
    new ResourceTemplate('spicedb://definition/{objectType}', {
      list: undefined,
    }),
    async (uri, { objectType }) => {
      try {
        const response = (await spiceDB.readSchema({
          consistency: spiceDB.fullConsistency(),
        })) as any;

        // Parse schema to extract the specific object definition
        const schemaText = response.schemaText;
        const lines = schemaText.split('\n');

        let definition = '';
        let insideDefinition = false;
        let braceCount = 0;

        for (const line of lines) {
          if (
            !insideDefinition &&
            line.startsWith(`definition ${objectType} {`)
          ) {
            insideDefinition = true;
            braceCount = 1;
          }

          if (insideDefinition) {
            definition += line + '\n';

            // Count braces to know when the definition block ends
            braceCount += (line.match(/{/g) || []).length;
            braceCount -= (line.match(/}/g) || []).length;

            if (braceCount === 0) {
              insideDefinition = false;
            }
          }
        }

        if (!definition) {
          return {
            contents: [
              {
                uri: uri.href,
                text: `No definition found for object type: ${objectType}`,
                mimeType: 'text/plain',
              },
            ],
          };
        }

        return {
          contents: [
            {
              uri: uri.href,
              text: definition,
              mimeType: 'text/plain',
            },
          ],
        };
      } catch (error) {
        console.error(
          `Error fetching object definition for ${objectType}:`,
          error
        );
        return {
          contents: [
            {
              uri: uri.href,
              text: `Error fetching object definition: ${error}`,
              mimeType: 'text/plain',
            },
          ],
        };
      }
    }
  );
}

function registerTools(server: McpServer) {
  // Read Schema tool
  server.tool(
    'read-schema',
    'Retrieves the complete schema from the SpiceDB instance. The schema defines all object types, relations, permissions, and caveats in the system. This tool requires no parameters and returns the raw schema text as defined in SpiceDB.',
    {}, // No parameters needed
    async () => {
      try {
        // Log tool execution through console
        logMessage(server, 'info', 'Executing read-schema tool');

        const response = (await spiceDB.readSchema({
          consistency: spiceDB.fullConsistency(),
        })) as any;

        // Log successful execution
        logMessage(server, 'info', 'Successfully retrieved schema');

        // Extract object definitions from schema to create resources
        const schemaText = response.schemaText;
        const objectDefResources =
          extractObjectDefinitionsFromSchema(schemaText);

        return {
          content: [
            {
              type: 'text',
              text: response.schemaText,
            },
          ],
          resources: objectDefResources,
        };
      } catch (error) {
        // Log error through console for server-side debugging
        console.error('Error reading schema:', error);

        // Log error through console for client visibility
        logMessage(server, 'error', `Failed to read schema: ${error}`);

        return {
          content: [
            {
              type: 'text',
              text: `Error reading schema: ${error}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Read Relationships tool
  server.tool(
    'read-relationships',
    'Finds and retrieves relationships in the SpiceDB system matching the provided filters. All parameters are optional, allowing you to filter with varying levels of specificity - from all relationships in the system to a very specific relationship between two objects.',
    {
      resourceType: z.string().optional(),
      resourceId: z.string().optional(),
      relation: z.string().optional(),
      subjectType: z.string().optional(),
      subjectId: z.string().optional(),
      subjectRelation: z.string().optional(),
    },
    async ({
      resourceType,
      resourceId,
      relation,
      subjectType,
      subjectId,
      subjectRelation,
    }) => {
      try {
        const filter = spiceDB.createRelationshipFilter(
          resourceType,
          resourceId,
          relation,
          subjectType,
          subjectId,
          subjectRelation
        );

        // Read relationships matching the filter
        const results = await spiceDB.readRelationships({
          consistency: spiceDB.fullConsistency(),
          relationshipFilter: filter,
        });

        let relationships = '';
        let count = 0;
        const relationshipResources = [];

        for (const result of results) {
          const rel = (result as any).relationship;
          if (rel) {
            const resourceType = rel.resource.objectType;
            const resourceId = rel.resource.objectId;
            const resource = `${resourceType}:${resourceId}`;
            const relation = rel.relation;
            const subject = spiceDB.subjectRefToString(rel.subject);
            const relationshipString = `${resource}#${relation}@${subject}`;

            // Add to text output
            relationships += `${relationshipString}\n`;

            // Create resource for each relationship
            relationshipResources.push({
              uri: `spicedb://relationships/${resourceType}/${resourceId}/${relation}`,
              name: relationshipString,
              description: `Relationship between ${resource} and ${subject}`,
            });

            count++;
          }
        }

        if (count === 0) {
          return {
            content: [
              {
                type: 'text',
                text: 'No relationships found matching the specified filter.',
              },
            ],
          };
        }

        return {
          content: [
            {
              type: 'text',
              text: `Found ${count} relationship(s):\n\n${relationships}`,
            },
          ],
          resources: relationshipResources,
        };
      } catch (error) {
        console.error('Error reading relationships:', error);
        return {
          content: [
            {
              type: 'text',
              text: `Error reading relationships: ${error}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Check Permission tool
  server.tool(
    'check-permission',
    'Checks whether a specific subject has a particular permission on a resource. This is the core authorization check function of SpiceDB - determining "Can subject X perform action Y on resource Z?" The tool will return the result of the permission check along with details about the resources and subject involved and tracing information that explains how the authorization decision was made.',
    {
      resourceType: z.string(),
      resourceId: z.string(),
      permission: z.string(),
      subjectType: z.string(),
      subjectId: z.string(),
      subjectRelation: z.string().optional(),
    },
    async ({
      resourceType,
      resourceId,
      permission,
      subjectType,
      subjectId,
      subjectRelation,
    }) => {
      try {
        const subject: any = {
          object: {
            objectType: subjectType,
            objectId: subjectId,
          },
        };

        if (subjectRelation) {
          subject.optionalRelation = subjectRelation;
        }

        const response = (await spiceDB.checkPermission({
          consistency: spiceDB.fullConsistency(),
          resource: {
            objectType: resourceType,
            objectId: resourceId,
          },
          permission,
          subject,
          withTracing: true,
        })) as any;

        const permissionship = response.permissionship;
        const debugTrace = response.debugTrace;

        let result;
        switch (permissionship) {
          case 'PERMISSIONSHIP_NO_PERMISSION': // PERMISSIONSHIP_NO_PERMISSION
            result = 'NO PERMISSION';
            break;
          case 'PERMISSIONSHIP_HAS_PERMISSION': // PERMISSIONSHIP_HAS_PERMISSION
            result = 'HAS PERMISSION';
            break;
          case 'PERMISSIONSHIP_CONDITIONAL_PERMISSION': // PERMISSIONSHIP_CONDITIONAL_PERMISSION
            result = 'CONDITIONAL PERMISSION';
            break;
          default:
            result = 'UNKNOWN';
        }

        // Generate a human-readable explanation based on the debug trace
        let explanation = '';
        if (debugTrace && debugTrace.check) {
          explanation = generateTraceExplanation(debugTrace.check, 0);
        }

        let schemaContext = '';
        if (debugTrace && debugTrace.schemaUsed) {
          schemaContext = `\n\nRelevant schema:\n\`\`\`zed\n${debugTrace.schemaUsed}\n\`\`\``;
        }

        return {
          content: [
            {
              type: 'text',
              text: `Permission check result: ${result}

Resource: ${resourceType}:${resourceId}
Permission: ${permission}
Subject: ${subjectType}:${subjectId}${
                subjectRelation ? '#' + subjectRelation : ''
              }

Explanation:
${explanation}${schemaContext}`,
            },
          ],
        };
      } catch (error) {
        console.error('Error checking permission:', error);
        return {
          content: [
            {
              type: 'text',
              text: `Error checking permission: ${error}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Lookup Resources tool
  server.tool(
    'lookup-resources',
    'Finds all resources of a specified type where a subject has a particular permission. This is useful for answering questions like "What documents can this user view?" or "Which projects can this group manage?" The tool returns a list of resource IDs that match the criteria.',
    {
      resourceType: z.string(),
      permission: z.string(),
      subjectType: z.string(),
      subjectId: z.string(),
      subjectRelation: z.string().optional(),
    },
    async ({
      resourceType,
      permission,
      subjectType,
      subjectId,
      subjectRelation,
    }) => {
      try {
        const subject: any = {
          object: {
            objectType: subjectType,
            objectId: subjectId,
          },
        };

        if (subjectRelation) {
          subject.optionalRelation = subjectRelation;
        }

        const results = await spiceDB.lookupResources({
          consistency: spiceDB.fullConsistency(),
          resourceObjectType: resourceType,
          permission,
          subject,
        });

        let resources = '';
        let count = 0;

        for (const result of results) {
          const resultObj = result as any;

          // Handle result format directly
          if (resultObj.resourceObjectId) {
            resources += `${resourceType}:${resultObj.resourceObjectId}\n`;
            count++;
          }
        }

        if (count === 0) {
          return {
            content: [
              {
                type: 'text',
                text: `No resources of type ${resourceType} found where subject ${subjectType}:${subjectId}${
                  subjectRelation ? '#' + subjectRelation : ''
                } has permission ${permission}.`,
              },
            ],
          };
        }

        return {
          content: [
            {
              type: 'text',
              text: `Found ${count} resource(s) where subject ${subjectType}:${subjectId}${
                subjectRelation ? '#' + subjectRelation : ''
              } has permission ${permission}:\n\n${resources}`,
            },
          ],
        };
      } catch (error) {
        console.error('Error looking up resources:', error);
        return {
          content: [
            {
              type: 'text',
              text: `Error looking up resources: ${error}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Lookup Subjects tool
  server.tool(
    'lookup-subjects',
    'Finds all subjects of a specified type that have a particular permission on a resource. This is useful for answering questions like "Who can edit this document?" or "Which users can manage this project?" The tool returns a list of subject IDs that match the criteria, potentially including wildcard subjects with exclusions.',
    {
      resourceType: z.string(),
      resourceId: z.string(),
      permission: z.string(),
      subjectType: z.string(),
      subjectRelation: z.string().optional(),
    },
    async ({
      resourceType,
      resourceId,
      permission,
      subjectType,
      subjectRelation,
    }) => {
      try {
        const lookupRequest: any = {
          consistency: spiceDB.fullConsistency(),
          resource: {
            objectType: resourceType,
            objectId: resourceId,
          },
          permission,
          subjectObjectType: subjectType,
        };

        if (subjectRelation) {
          lookupRequest.optionalSubjectRelation = subjectRelation;
        }

        const results = await spiceDB.lookupSubjects(lookupRequest);

        let subjects = '';
        let count = 0;

        for (const result of results) {
          const resultObj = result as any;

          // Handle new format response
          if (resultObj.subjectObjectId) {
            const subjectId = resultObj.subjectObjectId;

            // Check for wildcard with exclusions
            if (
              subjectId === '*' &&
              resultObj.excludedSubjects &&
              Array.isArray(resultObj.excludedSubjects) &&
              resultObj.excludedSubjects.length > 0
            ) {
              subjects += `${subjectType}:* (with exclusions)\n`;
              subjects += 'Exclusions:\n';

              for (const excluded of resultObj.excludedSubjects) {
                subjects += `- ${subjectType}:${excluded.subjectObjectId}\n`;
              }
            } else {
              subjects += `${subjectType}:${subjectId}${
                subjectRelation ? '#' + subjectRelation : ''
              }\n`;
            }

            count++;
          }
          // Handle legacy format response
          else if (resultObj.subject) {
            const subjectId = resultObj.subject.subjectObjectId;

            // Check for wildcard
            if (
              subjectId === '*' &&
              resultObj.excludedSubjects &&
              Array.isArray(resultObj.excludedSubjects) &&
              resultObj.excludedSubjects.length > 0
            ) {
              subjects += `${subjectType}:* (with exclusions)\n`;
              subjects += 'Exclusions:\n';

              for (const excluded of resultObj.excludedSubjects) {
                subjects += `- ${subjectType}:${excluded.subjectObjectId}\n`;
              }
            } else {
              subjects += `${subjectType}:${subjectId}${
                subjectRelation ? '#' + subjectRelation : ''
              }\n`;
            }

            count++;
          }
        }

        if (count === 0) {
          return {
            content: [
              {
                type: 'text',
                text: `No subjects of type ${subjectType} found with permission ${permission} on resource ${resourceType}:${resourceId}.`,
              },
            ],
          };
        }

        return {
          content: [
            {
              type: 'text',
              text: `Found ${count} subject(s) with permission ${permission} on resource ${resourceType}:${resourceId}:\n\n${subjects}`,
            },
          ],
        };
      } catch (error) {
        console.error('Error looking up subjects:', error);
        return {
          content: [
            {
              type: 'text',
              text: `Error looking up subjects: ${error}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Write Relationship tool
  server.tool(
    'write-relationship',
    'Creates, updates, or deletes a relationship in the SpiceDB system. This tool allows for modifying the permission graph by establishing or removing relationships between resources and subjects. The operation parameter determines whether to create only if not exists (CREATE), upsert (TOUCH), or delete (DELETE) the relationship.',
    {
      operation: z.enum(['CREATE', 'TOUCH', 'DELETE']),
      resourceType: z.string(),
      resourceId: z.string(),
      relation: z.string(),
      subjectType: z.string(),
      subjectId: z.string(),
      subjectRelation: z.string().optional(),
    },
    async ({
      operation,
      resourceType,
      resourceId,
      relation,
      subjectType,
      subjectId,
      subjectRelation,
    }) => {
      try {
        const relationship = spiceDB.createRelationship(
          resourceType,
          resourceId,
          relation,
          subjectType,
          subjectId,
          subjectRelation
        );

        // Map operation to SpiceDB operation
        let spiceDBOperation;
        switch (operation) {
          case 'CREATE':
            spiceDBOperation = 'OPERATION_CREATE'; // OPERATION_CREATE
            break;
          case 'TOUCH':
            spiceDBOperation = 'OPERATION_TOUCH'; // OPERATION_TOUCH
            break;
          case 'DELETE':
            spiceDBOperation = 'OPERATION_DELETE'; // OPERATION_DELETE
            break;
          default:
            throw new Error(`Unsupported operation: ${operation}`);
        }

        const response = await spiceDB.writeRelationships({
          updates: [
            {
              operation: spiceDBOperation,
              relationship,
            },
          ],
        });

        return {
          content: [
            {
              type: 'text',
              text: `Successfully performed operation ${operation} on relationship:

${resourceType}:${resourceId}#${relation}@${subjectType}:${subjectId}${
                subjectRelation ? '#' + subjectRelation : ''
              }`,
            },
          ],
        };
      } catch (error) {
        console.error('Error writing relationship:', error);
        return {
          content: [
            {
              type: 'text',
              text: `Error writing relationship: ${error}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}

function registerPrompts(server: McpServer) {
  // Prompt for looking up resources for a subject
  server.prompt(
    'lookup-resources-for-subject',
    {
      resourceType: z.string(),
      permission: z.string(),
      subjectType: z.string(),
      subjectId: z.string(),
      subjectRelation: z.string().optional(),
    },
    ({ resourceType, permission, subjectType, subjectId, subjectRelation }) => {
      const subjectString = `${subjectType}:${subjectId}${
        subjectRelation ? '#' + subjectRelation : ''
      }`;

      return {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Please find all resources of type \`${resourceType}\` where the subject \`${subjectString}\` has the permission \`${permission}\`.

For each resource, explain what it is and how the subject might interact with it given their permission level.`,
            },
          },
        ],
      };
    }
  );

  // Prompt for looking up subjects for a resource
  server.prompt(
    'lookup-subjects-for-resource',
    {
      resourceType: z.string(),
      resourceId: z.string(),
      permission: z.string(),
      subjectType: z.string(),
    },
    ({ resourceType, resourceId, permission, subjectType }) => {
      return {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Please find all subjects of type \`${subjectType}\` that have the permission \`${permission}\` on resource \`${resourceType}:${resourceId}\`.

For each subject, explain who they are and what they can do with this resource based on their permission level.`,
            },
          },
        ],
      };
    }
  );

  // Prompt for permission check explanation
  server.prompt(
    'explain-permission-check',
    {
      resourceType: z.string(),
      resourceId: z.string(),
      permission: z.string(),
      subjectType: z.string(),
      subjectId: z.string(),
    },
    ({ resourceType, resourceId, permission, subjectType, subjectId }) => {
      return {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Please check if the subject \`${subjectType}:${subjectId}\` has the permission \`${permission}\` on resource \`${resourceType}:${resourceId}\`.

Then explain:
1. What is the result of the permission check?
2. What does this permission allow the subject to do with this resource?
3. What relationships in the permission system contribute to this result?`,
            },
          },
        ],
      };
    }
  );

  // Prompt for schema analysis
  server.prompt('analyze-schema', {}, () => {
    return {
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Please analyze the current SpiceDB schema and explain:

1. What object types are defined?
2. For each object type, what relations and permissions does it have?
3. How are the permissions constructed (from which relations)?
4. How would you represent common permission patterns using this schema?

Please format your explanation in a clear, structured way that would help someone understand the permission model.`,
          },
        },
      ],
    };
  });
}

main().catch((error) => {
  console.error('Fatal error in SpiceDB MCP server:', error);
  process.exit(1);
});
