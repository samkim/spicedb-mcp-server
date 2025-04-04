import fetch from 'node-fetch';
import * as dotenv from 'dotenv';
import { Readable } from 'stream';

dotenv.config();

// SpiceDB API client that uses direct HTTP calls
export class SpiceDBClient {
  private endpoint: string;
  private apiKey: string;
  private useTLS: boolean;
  private static instance: SpiceDBClient;

  private constructor() {
    this.endpoint = process.env.SPICEDB_ENDPOINT || 'localhost:50051';
    this.apiKey = process.env.SPICEDB_API_KEY || '';
    this.useTLS = process.env.SPICEDB_USE_TLS === 'true';

    // Ensure endpoint has protocol
    if (!this.endpoint.startsWith('http')) {
      this.endpoint = `${this.useTLS ? 'https' : 'http'}://${this.endpoint}`;
    }
  }

  public static getInstance(): SpiceDBClient {
    if (!SpiceDBClient.instance) {
      console.error('Initializing SpiceDB client...');
      SpiceDBClient.instance = new SpiceDBClient();
      console.error(
        `SpiceDB client initialized with endpoint: ${SpiceDBClient.instance.endpoint}`
      );
      console.error(`TLS enabled: ${SpiceDBClient.instance.useTLS}`);
    }
    return SpiceDBClient.instance;
  }

  private async makeRequest(path: string, method: string, body?: any) {
    const url = `${this.endpoint}${path}`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json, application/x-ndjson',
    };

    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    try {
      // console.error(`[request] method:#{method} body:${body ? JSON.stringify(body) : 'none'}`);
      const response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`SpiceDB API error (${response.status}): ${errorText}`);
      }

      if (response.status === 204) {
        // No content
        return null;
      }

      // Read response as text and parse each line as JSON
      const responseText = await response.text();

      // If response is empty, return null
      if (!responseText.trim()) {
        return null;
      }

      // Parse each line as JSON
      const results = responseText
        .split('\n')
        .filter((line) => line.trim() !== '')
        .map((line) => {
          try {
            return JSON.parse(line);
          } catch (err) {
            console.error('Error parsing JSON line:', line, err);
            throw new Error(`Failed to parse JSON line: ${line}`);
          }
        });

      // For single-result responses, return the first result
      // For multi-line responses, return the full array
      const result = results.length === 1 ? results[0] : results;

      //console.error(`[result] ${JSON.stringify(result)}`);
      return result;
    } catch (error) {
      console.error(`Error making request to ${path}:`, error);
      throw error;
    }
  }

  // Helper to create a consistency object for all requests
  public fullConsistency() {
    return {
      fullyConsistent: true,
    };
  }

  // Helper to create a minimal latency consistency object
  public minimalLatency() {
    return {
      minimizeLatency: true,
    };
  }

  // Convert an object reference to a string
  public objectRefToString(ref: any): string {
    return `${ref.objectType}:${ref.objectId}`;
  }

  // Convert a subject reference to a string
  public subjectRefToString(ref: any): string {
    const base = this.objectRefToString(ref.object);
    if (ref.optionalRelation) {
      return `${base}#${ref.optionalRelation}`;
    }
    return base;
  }

  // Helper to parse a relationship string into components
  public parseRelationshipString(relationshipStr: string): {
    resourceType: string;
    resourceId: string;
    relation: string;
    subjectType: string;
    subjectId: string;
    optionalSubjectRelation?: string;
  } {
    // Expected format: resourceType:resourceId#relation@subjectType:subjectId[#subjectRelation]
    const parts = relationshipStr.split('#');
    const resourcePart = parts[0].split(':');

    if (parts.length < 2 || resourcePart.length !== 2) {
      throw new Error(`Invalid relationship format: ${relationshipStr}`);
    }

    const resourceType = resourcePart[0];
    const resourceId = resourcePart[1];

    const relationSubjectParts = parts[1].split('@');

    if (relationSubjectParts.length !== 2) {
      throw new Error(`Invalid relationship format: ${relationshipStr}`);
    }

    const relation = relationSubjectParts[0];
    const subjectPart = relationSubjectParts[1];

    // Handle optional subject relation
    let subjectType: string;
    let subjectId: string;
    let optionalSubjectRelation: string | undefined;

    if (subjectPart.includes('#')) {
      const subjectParts = subjectPart.split('#');
      const subjectRefParts = subjectParts[0].split(':');

      if (subjectRefParts.length !== 2) {
        throw new Error(`Invalid subject format: ${subjectPart}`);
      }

      subjectType = subjectRefParts[0];
      subjectId = subjectRefParts[1];
      optionalSubjectRelation = subjectParts[1];
    } else {
      const subjectRefParts = subjectPart.split(':');

      if (subjectRefParts.length !== 2) {
        throw new Error(`Invalid subject format: ${subjectPart}`);
      }

      subjectType = subjectRefParts[0];
      subjectId = subjectRefParts[1];
    }

    return {
      resourceType,
      resourceId,
      relation,
      subjectType,
      subjectId,
      optionalSubjectRelation,
    };
  }

  // Create a relationship object
  public createRelationship(
    resourceType: string,
    resourceId: string,
    relation: string,
    subjectType: string,
    subjectId: string,
    optionalSubjectRelation?: string
  ): any {
    const relationship: any = {
      resource: {
        objectType: resourceType,
        objectId: resourceId,
      },
      relation,
      subject: {
        object: {
          objectType: subjectType,
          objectId: subjectId,
        },
      },
    };

    if (optionalSubjectRelation) {
      relationship.subject.optionalRelation = optionalSubjectRelation;
    }

    return relationship;
  }

  // Create a relationship filter
  public createRelationshipFilter(
    resourceType?: string,
    resourceId?: string,
    relation?: string,
    subjectType?: string,
    subjectId?: string,
    subjectRelation?: string
  ): any {
    const filter: any = {};

    if (resourceType) {
      filter.resourceType = resourceType;
    }

    if (resourceId) {
      filter.optionalResourceId = resourceId;
    }

    if (relation) {
      filter.optionalRelation = relation;
    }

    if (subjectType) {
      filter.optionalSubjectFilter = {
        subjectType,
      };

      if (subjectId) {
        filter.optionalSubjectFilter.optionalSubjectId = subjectId;
      }

      if (subjectRelation) {
        filter.optionalSubjectFilter.optionalRelation = {
          relation: subjectRelation,
        };
      }
    }

    return filter;
  }

  // API methods based on SpiceDB OpenAPI spec

  // Read schema
  async readSchema(params: any = {}) {
    return this.makeRequest('/v1/schema/read', 'POST', params);
  }

  // Read relationships
  async readRelationships(params: any) {
    // This is a streaming API in the original, we'll need to handle pagination
    const results = [];
    let hasMore = true;
    let cursor = null;

    while (hasMore) {
      const requestParams = { ...params };
      if (cursor) {
        requestParams.optionalCursor = cursor;
      }

      const response = (await this.makeRequest(
        '/v1/relationships/read',
        'POST',
        requestParams
      )) as any;

      // Handle array response format
      if (Array.isArray(response)) {
        for (const item of response) {
          if (item.result && item.result.relationship) {
            results.push(item.result);

            // Update cursor to the last item's cursor if available
            if (item.result.afterResultCursor) {
              cursor = item.result.afterResultCursor;
            }
          }
        }
        // If we got results but no more cursor, we're done
        if (cursor === null || results.length === 0) {
          hasMore = false;
        }
      }
      // Handle legacy single object response format
      else if (response && 'relationship' in response) {
        results.push(response);

        if (response && 'afterResultCursor' in response) {
          cursor = response.afterResultCursor;
        } else {
          hasMore = false;
        }
      }
      // No results or unexpected format
      else {
        hasMore = false;
      }
    }

    return results;
  }

  // Check permission
  async checkPermission(params: any) {
    const modifiedParams = { ...params };

    // Add tracing parameter if it's not explicitly set
    if (params.withTracing === undefined) {
      modifiedParams.withTracing = true;
    }

    return this.makeRequest('/v1/permissions/check', 'POST', modifiedParams);
  }

  // Lookup resources
  async lookupResources(params: any) {
    // This is a streaming API in the original, we'll need to handle pagination
    const results = [];
    let hasMore = true;
    let cursor = null;

    while (hasMore) {
      const requestParams = { ...params };
      if (cursor) {
        requestParams.optionalCursor = cursor;
      }

      const response = (await this.makeRequest(
        '/v1/permissions/resources',
        'POST',
        requestParams
      )) as any;

      // Handle array response format
      if (Array.isArray(response)) {
        for (const item of response) {
          if (item.result) {
            results.push(item.result);

            // Update cursor to the last item's cursor if available
            if (item.result.afterResultCursor) {
              cursor = item.result.afterResultCursor;
            }
          }
        }
        // If we got results but no more cursor, we're done
        if (cursor === null || results.length === 0) {
          hasMore = false;
        }
      }
      // Handle legacy single object response format
      else if (response && 'resourceObjectId' in response) {
        results.push(response);

        if (response && 'afterResultCursor' in response) {
          cursor = response.afterResultCursor;
        } else {
          hasMore = false;
        }
      }
      // No results or unexpected format
      else {
        hasMore = false;
      }
    }

    return results;
  }

  // Lookup subjects
  async lookupSubjects(params: any) {
    // This is a streaming API in the original, we'll need to handle pagination
    const results = [];
    let hasMore = true;
    let cursor = null;

    while (hasMore) {
      const requestParams = { ...params };
      if (cursor) {
        requestParams.optionalCursor = cursor;
      }

      const response = (await this.makeRequest(
        '/v1/permissions/subjects',
        'POST',
        requestParams
      )) as any;

      // Handle array response format
      if (Array.isArray(response)) {
        for (const item of response) {
          if (item.result) {
            results.push(item.result);

            // Update cursor to the last item's cursor if available
            if (item.result.afterResultCursor) {
              cursor = item.result.afterResultCursor;
            }
          }
        }
        // If we got results but no more cursor, we're done
        if (cursor === null || results.length === 0) {
          hasMore = false;
        }
      }
      // Handle legacy single object response format
      else if (response) {
        results.push(response);

        if (response && 'afterResultCursor' in response) {
          cursor = response.afterResultCursor;
        } else {
          hasMore = false;
        }
      }
      // No results or unexpected format
      else {
        hasMore = false;
      }
    }

    return results;
  }

  // Write relationships
  async writeRelationships(params: any) {
    return this.makeRequest('/v1/relationships/write', 'POST', params);
  }

  // Delete relationships
  async deleteRelationships(params: any) {
    return this.makeRequest('/v1/relationships/delete', 'POST', params);
  }
}
