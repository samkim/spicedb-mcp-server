import express from 'express';
import bodyParser from 'body-parser';
import axios from 'axios';

/**
 * SpiceDB Model Context Protocol Server
 * This server implements the Model Context Protocol to expose SpiceDB APIs
 * as resources and tools in the MCP format.
 */

interface MCPResource {
  id: string;
  type: string;
  properties: Record<string, any>;
  content?: string;
}

interface MCPTool {
  name: string;
  description: string;
  parameters: Record<string, any>;
  returnDirect: boolean;
}

interface MCPToolCall {
  id: string;
  tool: string;
  parameters: Record<string, any>;
}

interface MCPToolResponse {
  id: string;
  status: 'success' | 'error';
  content?: string;
  error?: {
    message: string;
    type: string;
  };
}

class SpiceDBClient {
  private baseUrl: string;
  private apiKey: string;

  constructor(baseUrl: string, apiKey: string) {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
  }

  private async makeRequest(method: string, path: string, body?: any) {
    try {
      const response = await axios({
        method,
        url: `${this.baseUrl}${path}`,
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        data: body
      });
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response) {
        throw new Error(`SpiceDB API Error: ${error.response.status} ${JSON.stringify(error.response.data)}`);
      }
      throw error;
    }
  }

  // Schema API
  async readSchema() {
    return this.makeRequest('POST', '/v1/schema/read', {});
  }

  async writeSchema(schema: string) {
    return this.makeRequest('POST', '/v1/schema/write', { schema });
  }

  async reflectSchema() {
    return this.makeRequest('POST', '/v1/schema/reflectschema', {
      consistency: { minimizeLatency: true }
    });
  }

  // Relationships API
  async readRelationships(filter: any) {
    return this.makeRequest('POST', '/v1/relationships/read', {
      consistency: { minimizeLatency: true },
      relationshipFilter: filter
    });
  }

  async writeRelationships(updates: any[]) {
    return this.makeRequest('POST', '/v1/relationships/write', {
      updates
    });
  }

  async deleteRelationships(filter: any) {
    return this.makeRequest('POST', '/v1/relationships/delete', {
      relationshipFilter: filter
    });
  }

  // Permissions API
  async checkPermission(resource: any, permission: string, subject: any) {
    return this.makeRequest('POST', '/v1/permissions/check', {
      consistency: { minimizeLatency: true },
      resource,
      permission,
      subject
    });
  }

  async lookupResources(resourceType: string, permission: string, subject: any) {
    return this.makeRequest('POST', '/v1/permissions/resources', {
      consistency: { minimizeLatency: true },
      resourceObjectType: resourceType,
      permission,
      subject
    });
  }

  async lookupSubjects(resource: any, permission: string, subjectType: string) {
    return this.makeRequest('POST', '/v1/permissions/subjects', {
      consistency: { minimizeLatency: true },
      resource,
      permission,
      subjectObjectType: subjectType
    });
  }

  async expandPermissionTree(resource: any, permission: string) {
    return this.makeRequest('POST', '/v1/permissions/expand', {
      consistency: { minimizeLatency: true },
      resource,
      permission
    });
  }
}

class SpiceDBMCPServer {
  private app: express.Application;
  private client: SpiceDBClient;
  private port: number;

  constructor(spicedbUrl: string, spicedbApiKey: string, port: number = 3000) {
    this.app = express();
    this.client = new SpiceDBClient(spicedbUrl, spicedbApiKey);
    this.port = port;

    // Configure Express
    this.app.use(bodyParser.json());
    this.setupRoutes();
  }

  private setupRoutes() {
    // MCP Resource endpoints
    this.app.get('/mcp/resources', this.handleListResources.bind(this));
    this.app.get('/mcp/resources/:id', this.handleGetResource.bind(this));

    // MCP Tool endpoints
    this.app.get('/mcp/tools', this.handleListTools.bind(this));
    this.app.post('/mcp/tools/:name/call', this.handleToolCall.bind(this));
  }

  private async handleListResources(req: express.Request, res: express.Response) {
    try {
      // List available SpiceDB resources
      const resources: MCPResource[] = [
        {
          id: 'schema',
          type: 'spicedb/schema',
          properties: {
            description: 'The current SpiceDB schema'
          }
        },
        {
          id: 'relationships',
          type: 'spicedb/relationships',
          properties: {
            description: 'Relationships stored in SpiceDB'
          }
        }
      ];
      
      res.json(resources);
    } catch (error) {
      res.status(500).json({ 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
    }
  }

  private async handleGetResource(req: express.Request, res: express.Response) {
    try {
      const resourceId = req.params.id;
      let resource: MCPResource | null = null;

      if (resourceId === 'schema') {
        const schemaResponse = await this.client.readSchema();
        resource = {
          id: 'schema',
          type: 'spicedb/schema',
          properties: {
            description: 'The current SpiceDB schema',
            updated_at: new Date().toISOString()
          },
          content: schemaResponse.schemaText
        };
      } else if (resourceId === 'relationships') {
        // For relationships, we return a description rather than all relationships
        // since that could be a very large dataset
        resource = {
          id: 'relationships',
          type: 'spicedb/relationships',
          properties: {
            description: 'Relationships stored in SpiceDB',
            note: 'Use the readRelationships tool to query specific relationships'
          }
        };
      }

      if (resource) {
        res.json(resource);
      } else {
        res.status(404).json({ error: 'Resource not found' });
      }
    } catch (error) {
      res.status(500).json({ 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
    }
  }

  private async handleListTools(req: express.Request, res: express.Response) {
    try {
      const tools: MCPTool[] = [
        {
          name: 'readSchema',
          description: 'Read the current SpiceDB schema',
          parameters: {},
          returnDirect: false
        },
        {
          name: 'writeSchema',
          description: 'Write a new SpiceDB schema',
          parameters: {
            schema: {
              type: 'string',
              description: 'The schema text to write'
            }
          },
          returnDirect: false
        },
        {
          name: 'readRelationships',
          description: 'Read relationships matching a filter',
          parameters: {
            resourceType: {
              type: 'string',
              description: 'Optional resource type to filter by'
            },
            resourceId: {
              type: 'string',
              description: 'Optional resource ID to filter by'
            },
            relation: {
              type: 'string',
              description: 'Optional relation to filter by'
            }
          },
          returnDirect: false
        },
        {
          name: 'writeRelationship',
          description: 'Create or update a relationship',
          parameters: {
            resourceType: {
              type: 'string',
              description: 'Resource type'
            },
            resourceId: {
              type: 'string',
              description: 'Resource ID'
            },
            relation: {
              type: 'string',
              description: 'Relation name'
            },
            subjectType: {
              type: 'string',
              description: 'Subject type'
            },
            subjectId: {
              type: 'string',
              description: 'Subject ID'
            },
            subjectRelation: {
              type: 'string',
              description: 'Optional subject relation'
            }
          },
          returnDirect: false
        },
        {
          name: 'deleteRelationships',
          description: 'Delete relationships matching a filter',
          parameters: {
            resourceType: {
              type: 'string',
              description: 'Resource type to filter by'
            },
            resourceId: {
              type: 'string',
              description: 'Optional resource ID to filter by'
            },
            relation: {
              type: 'string',
              description: 'Optional relation to filter by'
            }
          },
          returnDirect: false
        },
        {
          name: 'checkPermission',
          description: 'Check if a subject has a permission on a resource',
          parameters: {
            resourceType: {
              type: 'string',
              description: 'Resource type'
            },
            resourceId: {
              type: 'string',
              description: 'Resource ID'
            },
            permission: {
              type: 'string',
              description: 'Permission or relation to check'
            },
            subjectType: {
              type: 'string',
              description: 'Subject type'
            },
            subjectId: {
              type: 'string',
              description: 'Subject ID'
            },
            subjectRelation: {
              type: 'string',
              description: 'Optional subject relation'
            }
          },
          returnDirect: false
        },
        {
          name: 'lookupResources',
          description: 'Find resources of a type that a subject can access',
          parameters: {
            resourceType: {
              type: 'string',
              description: 'Resource type to look up'
            },
            permission: {
              type: 'string',
              description: 'Permission or relation to check'
            },
            subjectType: {
              type: 'string',
              description: 'Subject type'
            },
            subjectId: {
              type: 'string',
              description: 'Subject ID'
            },
            subjectRelation: {
              type: 'string',
              description: 'Optional subject relation'
            }
          },
          returnDirect: false
        },
        {
          name: 'lookupSubjects',
          description: 'Find subjects that have a permission on a resource',
          parameters: {
            resourceType: {
              type: 'string',
              description: 'Resource type'
            },
            resourceId: {
              type: 'string',
              description: 'Resource ID'
            },
            permission: {
              type: 'string',
              description: 'Permission or relation to check'
            },
            subjectType: {
              type: 'string',
              description: 'Subject type to look up'
            }
          },
          returnDirect: false
        },
        {
          name: 'expandPermissionTree',
          description: 'Expand the permission tree for a resource and permission',
          parameters: {
            resourceType: {
              type: 'string',
              description: 'Resource type'
            },
            resourceId: {
              type: 'string',
              description: 'Resource ID'
            },
            permission: {
              type: 'string',
              description: 'Permission or relation to expand'
            }
          },
          returnDirect: false
        },
      ];
      
      res.json(tools);
    } catch (error) {
      res.status(500).json({ 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
    }
  }

  private async handleToolCall(req: express.Request, res: express.Response) {
    try {
      const toolName = req.params.name;
      const toolCall = req.body as MCPToolCall;
      let response: MCPToolResponse;

      switch (toolName) {
        case 'readSchema':
          response = await this.handleReadSchemaTool(toolCall);
          break;
        case 'writeSchema':
          response = await this.handleWriteSchemaTool(toolCall);
          break;
        case 'readRelationships':
          response = await this.handleReadRelationshipsTool(toolCall);
          break;
        case 'writeRelationship':
          response = await this.handleWriteRelationshipTool(toolCall);
          break;
        case 'deleteRelationships':
          response = await this.handleDeleteRelationshipsTool(toolCall);
          break;
        case 'checkPermission':
          response = await this.handleCheckPermissionTool(toolCall);
          break;
        case 'lookupResources':
          response = await this.handleLookupResourcesTool(toolCall);
          break;
        case 'lookupSubjects':
          response = await this.handleLookupSubjectsTool(toolCall);
          break;
        case 'expandPermissionTree':
          response = await this.handleExpandPermissionTreeTool(toolCall);
          break;
        default:
          response = {
            id: toolCall.id,
            status: 'error',
            error: {
              message: `Unknown tool: ${toolName}`,
              type: 'UNKNOWN_TOOL'
            }
          };
      }

      res.json(response);
    } catch (error) {
      res.status(500).json({ 
        id: (req.body as MCPToolCall)?.id || 'unknown',
        status: 'error',
        error: {
          message: error instanceof Error ? error.message : 'Unknown error',
          type: 'SERVER_ERROR'
        }
      });
    }
  }

  private async handleReadSchemaTool(toolCall: MCPToolCall): Promise<MCPToolResponse> {
    try {
      const schemaResponse = await this.client.readSchema();
      return {
        id: toolCall.id,
        status: 'success',
        content: JSON.stringify({
          schema: schemaResponse.schemaText,
          readAt: schemaResponse.readAt
        })
      };
    } catch (error) {
      return {
        id: toolCall.id,
        status: 'error',
        error: {
          message: error instanceof Error ? error.message : 'Unknown error',
          type: 'TOOL_EXECUTION_ERROR'
        }
      };
    }
  }

  private async handleWriteSchemaTool(toolCall: MCPToolCall): Promise<MCPToolResponse> {
    try {
      const { schema } = toolCall.parameters;
      if (!schema) {
        throw new Error('Missing required parameter: schema');
      }

      const response = await this.client.writeSchema(schema);
      return {
        id: toolCall.id,
        status: 'success',
        content: JSON.stringify({
          writtenAt: response.writtenAt
        })
      };
    } catch (error) {
      return {
        id: toolCall.id,
        status: 'error',
        error: {
          message: error instanceof Error ? error.message : 'Unknown error',
          type: 'TOOL_EXECUTION_ERROR'
        }
      };
    }
  }

  private async handleReadRelationshipsTool(toolCall: MCPToolCall): Promise<MCPToolResponse> {
    try {
      const { resourceType, resourceId, relation } = toolCall.parameters;
      
      const filter: any = {};
      if (resourceType) filter.resourceType = resourceType;
      if (resourceId) filter.optionalResourceId = resourceId;
      if (relation) filter.optionalRelation = relation;

      // Stream-based API, but we'll collect all relationships for simplicity
      const relationships: any[] = [];
      try {
        const responseStream = await this.client.readRelationships(filter);
        // Here we'd need to handle stream processing
        // For simplicity, assuming we get all relationships at once
        relationships.push(responseStream);
      } catch (error) {
        // Handle stream errors
      }

      return {
        id: toolCall.id,
        status: 'success',
        content: JSON.stringify({
          relationships
        })
      };
    } catch (error) {
      return {
        id: toolCall.id,
        status: 'error',
        error: {
          message: error instanceof Error ? error.message : 'Unknown error',
          type: 'TOOL_EXECUTION_ERROR'
        }
      };
    }
  }

  private async handleWriteRelationshipTool(toolCall: MCPToolCall): Promise<MCPToolResponse> {
    try {
      const { 
        resourceType, 
        resourceId, 
        relation, 
        subjectType, 
        subjectId, 
        subjectRelation 
      } = toolCall.parameters;

      if (!resourceType || !resourceId || !relation || !subjectType || !subjectId) {
        throw new Error('Missing required parameters');
      }

      const resource = { objectType: resourceType, objectId: resourceId };
      const subject = { 
        object: { objectType: subjectType, objectId: subjectId },
        optionalRelation: subjectRelation
      };

      const updates = [{
        operation: 'OPERATION_TOUCH',
        relationship: {
          resource,
          relation,
          subject
        }
      }];

      const response = await this.client.writeRelationships(updates);
      return {
        id: toolCall.id,
        status: 'success',
        content: JSON.stringify({
          writtenAt: response.writtenAt
        })
      };
    } catch (error) {
      return {
        id: toolCall.id,
        status: 'error',
        error: {
          message: error instanceof Error ? error.message : 'Unknown error',
          type: 'TOOL_EXECUTION_ERROR'
        }
      };
    }
  }

  private async handleDeleteRelationshipsTool(toolCall: MCPToolCall): Promise<MCPToolResponse> {
    try {
      const { resourceType, resourceId, relation } = toolCall.parameters;
      
      if (!resourceType) {
        throw new Error('Missing required parameter: resourceType');
      }

      const filter: any = { resourceType };
      if (resourceId) filter.optionalResourceId = resourceId;
      if (relation) filter.optionalRelation = relation;

      const response = await this.client.deleteRelationships(filter);
      return {
        id: toolCall.id,
        status: 'success',
        content: JSON.stringify({
          deletedAt: response.deletedAt,
          relationshipsDeletedCount: response.relationshipsDeletedCount,
          deletionProgress: response.deletionProgress
        })
      };
    } catch (error) {
      return {
        id: toolCall.id,
        status: 'error',
        error: {
          message: error instanceof Error ? error.message : 'Unknown error',
          type: 'TOOL_EXECUTION_ERROR'
        }
      };
    }
  }

  private async handleCheckPermissionTool(toolCall: MCPToolCall): Promise<MCPToolResponse> {
    try {
      const { 
        resourceType, 
        resourceId, 
        permission, 
        subjectType, 
        subjectId, 
        subjectRelation 
      } = toolCall.parameters;

      if (!resourceType || !resourceId || !permission || !subjectType || !subjectId) {
        throw new Error('Missing required parameters');
      }

      const resource = { objectType: resourceType, objectId: resourceId };
      const subject = { 
        object: { objectType: subjectType, objectId: subjectId },
        optionalRelation: subjectRelation
      };

      const response = await this.client.checkPermission(resource, permission, subject);
      return {
        id: toolCall.id,
        status: 'success',
        content: JSON.stringify({
          permissionship: response.permissionship,
          checkedAt: response.checkedAt,
          optionalExpiresAt: response.optionalExpiresAt,
          partialCaveatInfo: response.partialCaveatInfo
        })
      };
    } catch (error) {
      return {
        id: toolCall.id,
        status: 'error',
        error: {
          message: error instanceof Error ? error.message : 'Unknown error',
          type: 'TOOL_EXECUTION_ERROR'
        }
      };
    }
  }

  private async handleLookupResourcesTool(toolCall: MCPToolCall): Promise<MCPToolResponse> {
    try {
      const { 
        resourceType, 
        permission, 
        subjectType, 
        subjectId, 
        subjectRelation 
      } = toolCall.parameters;

      if (!resourceType || !permission || !subjectType || !subjectId) {
        throw new Error('Missing required parameters');
      }

      const subject = { 
        object: { objectType: subjectType, objectId: subjectId },
        optionalRelation: subjectRelation
      };

      // Stream-based API, but we'll collect all resources for simplicity
      const resources: any[] = [];
      try {
        const responseStream = await this.client.lookupResources(resourceType, permission, subject);
        // Here we'd need to handle stream processing
        // For simplicity, assuming we get all resources at once
        resources.push(responseStream);
      } catch (error) {
        // Handle stream errors
      }

      return {
        id: toolCall.id,
        status: 'success',
        content: JSON.stringify({
          resources
        })
      };
    } catch (error) {
      return {
        id: toolCall.id,
        status: 'error',
        error: {
          message: error instanceof Error ? error.message : 'Unknown error',
          type: 'TOOL_EXECUTION_ERROR'
        }
      };
    }
  }

  private async handleLookupSubjectsTool(toolCall: MCPToolCall): Promise<MCPToolResponse> {
    try {
      const { 
        resourceType, 
        resourceId, 
        permission, 
        subjectType 
      } = toolCall.parameters;

      if (!resourceType || !resourceId || !permission || !subjectType) {
        throw new Error('Missing required parameters');
      }

      const resource = { objectType: resourceType, objectId: resourceId };

      // Stream-based API, but we'll collect all subjects for simplicity
      const subjects: any[] = [];
      try {
        const responseStream = await this.client.lookupSubjects(resource, permission, subjectType);
        // Here we'd need to handle stream processing
        // For simplicity, assuming we get all subjects at once
        subjects.push(responseStream);
      } catch (error) {
        // Handle stream errors
      }

      return {
        id: toolCall.id,
        status: 'success',
        content: JSON.stringify({
          subjects
        })
      };
    } catch (error) {
      return {
        id: toolCall.id,
        status: 'error',
        error: {
          message: error instanceof Error ? error.message : 'Unknown error',
          type: 'TOOL_EXECUTION_ERROR'
        }
      };
    }
  }

  private async handleExpandPermissionTreeTool(toolCall: MCPToolCall): Promise<MCPToolResponse> {
    try {
      const { resourceType, resourceId, permission } = toolCall.parameters;

      if (!resourceType || !resourceId || !permission) {
        throw new Error('Missing required parameters');
      }

      const resource = { objectType: resourceType, objectId: resourceId };
      const response = await this.client.expandPermissionTree(resource, permission);

      return {
        id: toolCall.id,
        status: 'success',
        content: JSON.stringify({
          expandedAt: response.expandedAt,
          treeRoot: response.treeRoot
        })
      };
    } catch (error) {
      return {
        id: toolCall.id,
        status: 'error',
        error: {
          message: error instanceof Error ? error.message : 'Unknown error',
          type: 'TOOL_EXECUTION_ERROR'
        }
      };
    }
  }

  public start() {
    this.app.listen(this.port, () => {
      console.log(`SpiceDB MCP server listening on port ${this.port}`);
    });
  }
}

// Example usage
if (require.main === module) {
  const spicedbUrl = process.env.SPICEDB_URL || 'http://localhost:50051';
  const spicedbApiKey = process.env.SPICEDB_API_KEY || 'your-api-key';
  const serverPort = parseInt(process.env.PORT || '3000', 10);

  const server = new SpiceDBMCPServer(spicedbUrl, spicedbApiKey, serverPort);
  server.start();
}

export default SpiceDBMCPServer;
