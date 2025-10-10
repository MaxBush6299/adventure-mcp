import sql from "mssql";
import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { ToolContext, isValidAuthContext } from './ToolContext.js';

/**
 * Column schema information
 */
interface ColumnSchema {
  name: string;
  type: string;
  maxLength: number | null;
  nullable: string;
  defaultValue: string | null;
  isIdentity: number;
  numericPrecision: number | null;
  numericScale: number | null;
}

/**
 * Sample data for learning patterns
 */
interface SampleData {
  [columnName: string]: any[];
}

/**
 * Foreign key relationship information
 */
interface ForeignKeyInfo {
  columnName: string;
  referencedSchema: string;
  referencedTable: string;
  referencedColumn: string;
  constraintName: string;
}

/**
 * Cached parent IDs for foreign key columns
 */
interface ParentIDCache {
  [key: string]: any[]; // key format: "schema.table.column"
}

/**
 * Generation strategy
 */
enum GenerationStrategy {
  SAMPLE_BASED = 'sample-based',
  PATTERN_BASED = 'pattern-based',
  RELATIONSHIP_BASED = 'relationship-based'
}

/**
 * Tool for generating synthetic test data based on table schema and existing data patterns
 * 
 * HYBRID APPROACH:
 * Phase 1: Sample-Based Learning - Learns from existing data to generate contextually similar data
 * Phase 2: Relationship Awareness - Understands foreign keys and related tables (planned)
 * Phase 3: LLM Enhancement - Optional AI-powered generation (planned)
 * 
 * Useful for testing, development, and demonstrating database capabilities
 */
export class GenerateSyntheticDataTool implements Tool {
  [key: string]: any;
  name = "generate_synthetic_data";
  description = `Generates synthetic test data for a specified table using intelligent pattern learning. 
  
FEATURES:
- Learns from existing data to match your domain (e.g., "widgets" not "software" for widget companies)
- Automatically detects column types and relationships
- Generates contextually appropriate data based on samples
- Falls back to pattern-based generation for empty tables

MODES:
- With existing data: Learns vocabulary, patterns, and distributions from samples
- Empty tables: Uses intelligent pattern matching based on column names
- Related tables: Respects foreign key relationships (Phase 2)

Useful for testing Row-Level Security, performance testing, customer demos, and development environments.`;
  
  inputSchema = {
    type: "object",
    properties: {
      tableName: { 
        type: "string", 
        description: "Table to generate data for (format: 'schema.table' or just 'table' for dbo schema, e.g., 'Sales.Customer', 'dbo.Products')" 
      },
      rowCount: {
        type: "number",
        description: "Number of rows to generate (minimum 1, maximum 10000)",
        minimum: 1,
        maximum: 10000
      },
      dataProfile: {
        type: "string",
        enum: ["realistic", "random", "edge-cases"],
        description: "Type of data to generate: 'realistic' (learns from existing data or uses smart patterns), 'random' (pure random values), 'edge-cases' (nulls, boundary values, special characters)"
      },
      learnFromExisting: {
        type: "boolean",
        description: "Whether to sample existing data and learn patterns (default: true). Set to false to use only pattern-based generation."
      },
      sampleSize: {
        type: "number",
        description: "Number of existing rows to sample for learning (default: 100, max: 1000). Only used if learnFromExisting is true.",
        minimum: 10,
        maximum: 1000
      }
    },
    required: ["tableName", "rowCount"],
  } as any;

  async run(params: any, context?: ToolContext) {
    try {
      const { 
        tableName, 
        rowCount = 100, 
        dataProfile = "realistic",
        learnFromExisting = true,
        sampleSize = 100
      } = params;
      
      // Validate row count
      if (rowCount < 1 || rowCount > 10000) {
        return {
          success: false,
          message: "Row count must be between 1 and 10000. For larger datasets, please run multiple batches."
        };
      }
      
      // Parse table name
      const [schema, table] = tableName.includes('.') 
        ? tableName.split('.') 
        : ['dbo', tableName];
      
      let request: sql.Request;
      
      // Get connection pool (per-user if authenticated, global if not)
      if (isValidAuthContext(context) && context) {
        const userId = context.userIdentity.oid || context.userIdentity.userId;
        const userEmail = context.userIdentity.email || context.userIdentity.upn;
        console.log(`[GenerateSyntheticDataTool] Using per-user pool for ${userEmail} (OID: ${userId})`);
        
        const pool = await context.poolManager.getPoolForUser(
          userId,
          context.userIdentity.sqlToken!,
          context.userIdentity.tokenExpiry!
        );
        request = pool.request();
      } else {
        console.log(`[GenerateSyntheticDataTool] Using global pool (no authentication context)`);
        request = new sql.Request();
      }
      
      // Step 1: Verify table exists and get schema
      console.log(`[GenerateSyntheticDataTool] Retrieving schema for ${schema}.${table}`);
      
      const schemaQuery = `
        SELECT 
          c.COLUMN_NAME as name,
          c.DATA_TYPE as type,
          c.CHARACTER_MAXIMUM_LENGTH as maxLength,
          c.IS_NULLABLE as nullable,
          c.COLUMN_DEFAULT as defaultValue,
          COLUMNPROPERTY(OBJECT_ID(c.TABLE_SCHEMA + '.' + c.TABLE_NAME), c.COLUMN_NAME, 'IsIdentity') as isIdentity,
          c.NUMERIC_PRECISION as numericPrecision,
          c.NUMERIC_SCALE as numericScale
        FROM INFORMATION_SCHEMA.COLUMNS c
        WHERE c.TABLE_SCHEMA = @schema 
          AND c.TABLE_NAME = @table
        ORDER BY c.ORDINAL_POSITION
      `;
      
      request.input("schema", sql.NVarChar, schema);
      request.input("table", sql.NVarChar, table);
      
      const schemaResult = await request.query(schemaQuery);
      const columns: ColumnSchema[] = schemaResult.recordset;
      
      if (columns.length === 0) {
        return {
          success: false,
          message: `Table ${schema}.${table} not found or has no columns. Please verify the table name and schema.`
        };
      }
      
      console.log(`[GenerateSyntheticDataTool] Found ${columns.length} columns in ${schema}.${table}`);
      
      // Step 2: Detect foreign key relationships (Phase 2)
      console.log(`[GenerateSyntheticDataTool] Detecting foreign key relationships...`);
      const foreignKeys = await this.detectForeignKeys(schema, table, context);
      const parentIDCache: ParentIDCache = {};
      
      // Pre-fetch parent IDs for all FK columns
      if (foreignKeys.length > 0) {
        console.log(`[GenerateSyntheticDataTool] Pre-fetching parent IDs for ${foreignKeys.length} foreign key(s)...`);
        for (const fk of foreignKeys) {
          const cacheKey = `${fk.referencedSchema}.${fk.referencedTable}.${fk.referencedColumn}`;
          
          // Find the child column to get its SQL type
          const childColumn = columns.find(col => col.name === fk.columnName);
          
          const parentIDs = await this.sampleParentIDs(
            fk.referencedSchema,
            fk.referencedTable,
            fk.referencedColumn,
            Math.max(sampleSize, 100), // At least 100 parent IDs
            context
          );
          
          if (parentIDs.length > 0) {
            // Filter parent IDs to match child column type constraints
            if (childColumn) {
              const filteredIDs = parentIDs.filter(id => this.isValidForType(id, childColumn.type));
              
              if (filteredIDs.length > 0) {
                parentIDCache[cacheKey] = filteredIDs;
                console.log(`[GenerateSyntheticDataTool] Cached ${filteredIDs.length}/${parentIDs.length} parent IDs for ${fk.columnName} (type: ${childColumn.type})`);
              } else {
                console.warn(`[GenerateSyntheticDataTool] All ${parentIDs.length} parent IDs filtered out for ${fk.columnName} due to type constraints (${childColumn.type})`);
              }
            } else {
              parentIDCache[cacheKey] = parentIDs;
            }
          }
        }
      }
      
      // Step 3: Determine generation strategy
      let strategy: GenerationStrategy = GenerationStrategy.PATTERN_BASED;
      let sampleData: SampleData | null = null;
      
      if (learnFromExisting && dataProfile === 'realistic') {
        // Try to sample existing data
        console.log(`[GenerateSyntheticDataTool] Attempting to learn from existing data (sample size: ${sampleSize})`);
        sampleData = await this.sampleExistingData(schema, table, columns, sampleSize, context);
        
        if (sampleData && Object.keys(sampleData).length > 0) {
          // If we also have FK relationships, use relationship-based strategy
          if (foreignKeys.length > 0 && Object.keys(parentIDCache).length > 0) {
            strategy = GenerationStrategy.RELATIONSHIP_BASED;
            console.log(`[GenerateSyntheticDataTool] Strategy: RELATIONSHIP_BASED - combining sample learning with FK awareness`);
          } else {
            strategy = GenerationStrategy.SAMPLE_BASED;
            console.log(`[GenerateSyntheticDataTool] Strategy: SAMPLE_BASED - learned patterns from ${Object.values(sampleData)[0]?.length || 0} existing rows`);
          }
        } else {
          console.log(`[GenerateSyntheticDataTool] Strategy: PATTERN_BASED - no existing data found, using intelligent patterns`);
        }
      } else {
        console.log(`[GenerateSyntheticDataTool] Strategy: PATTERN_BASED - learning disabled or non-realistic profile`);
      }
      
      // Step 4: Generate synthetic data
      console.log(`[GenerateSyntheticDataTool] Generating ${rowCount} rows with profile: ${dataProfile}`);
      const syntheticRows: any[] = [];
      
      for (let i = 0; i < rowCount; i++) {
        const row: any = {};
        
        for (const col of columns) {
          // Skip identity columns (auto-generated by database)
          if (col.isIdentity === 1) {
            continue;
          }
          
          // Skip columns with defaults in realistic mode (let DB handle them)
          if (col.defaultValue && dataProfile === "realistic") {
            continue;
          }
          
          // Check if this column is a foreign key
          const fkInfo = foreignKeys.find(fk => fk.columnName === col.name);
          
          if (fkInfo) {
            // Generate FK value from parent table
            const cacheKey = `${fkInfo.referencedSchema}.${fkInfo.referencedTable}.${fkInfo.referencedColumn}`;
            const parentIDs = parentIDCache[cacheKey];
            
            if (parentIDs && parentIDs.length > 0) {
              // Pick random parent ID
              let value = parentIDs[Math.floor(Math.random() * parentIDs.length)];
              row[col.name] = this.enforceTypeConstraints(value, col.type);
              console.log(`[GenerateSyntheticDataTool] Generated FK value for ${col.name}: ${row[col.name]} (from ${parentIDs.length} parent options)`);
            } else {
              // No parent IDs available - fall back to regular generation
              console.warn(`[GenerateSyntheticDataTool] No parent IDs for FK ${col.name}, falling back to pattern generation`);
              let value;
              if (strategy === GenerationStrategy.RELATIONSHIP_BASED || strategy === GenerationStrategy.SAMPLE_BASED) {
                value = sampleData ? this.generateFromSample(col, i, sampleData, dataProfile) : this.generateValue(col, i, dataProfile);
              } else {
                value = this.generateValue(col, i, dataProfile);
              }
              row[col.name] = this.enforceTypeConstraints(value, col.type);
            }
          } else {
            // Not a FK - generate based on strategy
            let value;
            if (strategy === GenerationStrategy.RELATIONSHIP_BASED || strategy === GenerationStrategy.SAMPLE_BASED) {
              value = sampleData ? this.generateFromSample(col, i, sampleData, dataProfile) : this.generateValue(col, i, dataProfile);
            } else {
              value = this.generateValue(col, i, dataProfile);
            }
            const constrainedValue = this.enforceTypeConstraints(value, col.type);
            console.log(`[GenerateSyntheticDataTool] Generated ${col.name} (${col.type}): ${value} -> ${constrainedValue}`);
            row[col.name] = constrainedValue;
          }
        }
        
        syntheticRows.push(row);
      }
      
      if (syntheticRows.length === 0 || Object.keys(syntheticRows[0]).length === 0) {
        return {
          success: false,
          message: `Unable to generate data - all columns are either identity or have defaults. Table may be fully auto-generated.`
        };
      }
      
      // Step 5: Insert data in batches
      console.log(`[GenerateSyntheticDataTool] Inserting data in batches of 100`);
      const batchSize = 100;
      let insertedCount = 0;
      
      for (let i = 0; i < syntheticRows.length; i += batchSize) {
        const batch = syntheticRows.slice(i, i + batchSize);
        
        // Create new request for each batch
        let batchRequest: sql.Request;
        if (isValidAuthContext(context) && context) {
          const userId = context.userIdentity.oid || context.userIdentity.userId;
          const pool = await context.poolManager.getPoolForUser(
            userId,
            context.userIdentity.sqlToken!,
            context.userIdentity.tokenExpiry!
          );
          batchRequest = pool.request();
        } else {
          batchRequest = new sql.Request();
        }
        
        const columnNames = Object.keys(batch[0]);
        const valueRows: string[] = [];
        
        // Build parameterized INSERT statement
        batch.forEach((row, idx) => {
          const placeholders = columnNames.map((col, colIdx) => 
            `@val_${i + idx}_${colIdx}`
          ).join(', ');
          valueRows.push(`(${placeholders})`);
          
          // Add parameters for this row
          columnNames.forEach((col, colIdx) => {
            const value = row[col];
            const column = columns.find(c => c.name === col);
            
            // Set appropriate SQL type based on column type
            if (value === null) {
              batchRequest.input(`val_${i + idx}_${colIdx}`, sql.NVarChar, null);
            } else {
              this.addInputParameter(batchRequest, `val_${i + idx}_${colIdx}`, value, column);
            }
          });
        });
        
        const insertQuery = `
          INSERT INTO [${schema}].[${table}] (${columnNames.map(c => `[${c}]`).join(', ')})
          VALUES ${valueRows.join(', ')}
        `;
        
        await batchRequest.query(insertQuery);
        insertedCount += batch.length;
        
        console.log(`[GenerateSyntheticDataTool] Batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(syntheticRows.length / batchSize)} complete (${insertedCount}/${rowCount} rows)`);
      }
      
      console.log(`[GenerateSyntheticDataTool] Successfully inserted ${insertedCount} rows into ${schema}.${table}`);
      
      // Build FK metadata for response
      const foreignKeysHandled = foreignKeys
        .filter(fk => {
          const cacheKey = `${fk.referencedSchema}.${fk.referencedTable}.${fk.referencedColumn}`;
          return parentIDCache[cacheKey] && parentIDCache[cacheKey].length > 0;
        })
        .map(fk => {
          const cacheKey = `${fk.referencedSchema}.${fk.referencedTable}.${fk.referencedColumn}`;
          return {
            column: fk.columnName,
            parentTable: `${fk.referencedSchema}.${fk.referencedTable}`,
            parentColumn: fk.referencedColumn,
            sampledValues: parentIDCache[cacheKey].length
          };
        });
      
      return {
        success: true,
        message: `Successfully generated and inserted ${insertedCount} synthetic rows into ${schema}.${table}`,
        details: {
          tableName: `${schema}.${table}`,
          rowsGenerated: rowCount,
          rowsInserted: insertedCount,
          dataProfile: dataProfile,
          generationStrategy: strategy,
          learnedFromSamples: strategy === GenerationStrategy.SAMPLE_BASED || strategy === GenerationStrategy.RELATIONSHIP_BASED,
          columnsPopulated: Object.keys(syntheticRows[0]).length,
          batchesProcessed: Math.ceil(syntheticRows.length / batchSize),
          foreignKeysDetected: foreignKeys.length,
          foreignKeysHandled: foreignKeysHandled
        }
      };
      
    } catch (error: any) {
      console.error(`[GenerateSyntheticDataTool] Error:`, error);
      return {
        success: false,
        message: `Failed to generate synthetic data: ${error.message || error}`,
        error: error.toString()
      };
    }
  }
  
  /**
   * Sample existing data from the table to learn patterns
   * Phase 1: Sample-Based Learning
   */
  private async sampleExistingData(
    schema: string, 
    table: string, 
    columns: ColumnSchema[], 
    sampleSize: number,
    context?: ToolContext
  ): Promise<SampleData | null> {
    try {
      // Get connection
      let request: sql.Request;
      if (isValidAuthContext(context) && context) {
        const userId = context.userIdentity.oid || context.userIdentity.userId;
        const pool = await context.poolManager.getPoolForUser(
          userId,
          context.userIdentity.sqlToken!,
          context.userIdentity.tokenExpiry!
        );
        request = pool.request();
      } else {
        request = new sql.Request();
      }
      
      // Build sample query (exclude identity columns)
      const nonIdentityColumns = columns.filter(c => c.isIdentity !== 1);
      if (nonIdentityColumns.length === 0) {
        return null;
      }
      
      const columnList = nonIdentityColumns.map(c => `[${c.name}]`).join(', ');
      const sampleQuery = `
        SELECT TOP ${sampleSize} ${columnList}
        FROM [${schema}].[${table}]
        ORDER BY NEWID()  -- Random sampling
      `;
      
      console.log(`[GenerateSyntheticDataTool] Sampling up to ${sampleSize} rows from ${schema}.${table}`);
      const result = await request.query(sampleQuery);
      
      if (result.recordset.length === 0) {
        console.log(`[GenerateSyntheticDataTool] No existing data found in ${schema}.${table}`);
        return null;
      }
      
      // Organize samples by column
      const sampleData: SampleData = {};
      for (const col of nonIdentityColumns) {
        sampleData[col.name] = result.recordset
          .map(row => row[col.name])
          .filter(val => val !== null && val !== undefined);
      }
      
      // Remove columns with no data
      Object.keys(sampleData).forEach(key => {
        if (sampleData[key].length === 0) {
          delete sampleData[key];
        }
      });
      
      if (Object.keys(sampleData).length === 0) {
        return null;
      }
      
      console.log(`[GenerateSyntheticDataTool] Sampled ${result.recordset.length} rows, learned patterns for ${Object.keys(sampleData).length} columns`);
      return sampleData;
      
    } catch (error: any) {
      console.error(`[GenerateSyntheticDataTool] Failed to sample existing data:`, error);
      return null; // Fall back to pattern-based generation
    }
  }
  
  /**
   * Detect foreign key relationships for a table (Phase 2: Relationship Awareness)
   */
  private async detectForeignKeys(
    schema: string,
    table: string,
    context?: ToolContext
  ): Promise<ForeignKeyInfo[]> {
    try {
      let request: sql.Request;
      
      // Get connection pool
      if (isValidAuthContext(context) && context) {
        const userId = context.userIdentity.oid || context.userIdentity.userId;
        const pool = await context.poolManager.getPoolForUser(
          userId,
          context.userIdentity.sqlToken!,
          context.userIdentity.tokenExpiry!
        );
        request = pool.request();
      } else {
        request = new sql.Request();
      }
      
      // Query to detect foreign keys
      const fkQuery = `
        SELECT 
          fk.name AS constraintName,
          COL_NAME(fkc.parent_object_id, fkc.parent_column_id) AS columnName,
          OBJECT_SCHEMA_NAME(fk.referenced_object_id) AS referencedSchema,
          OBJECT_NAME(fk.referenced_object_id) AS referencedTable,
          COL_NAME(fkc.referenced_object_id, fkc.referenced_column_id) AS referencedColumn
        FROM sys.foreign_keys fk
        INNER JOIN sys.foreign_key_columns fkc 
          ON fk.object_id = fkc.constraint_object_id
        WHERE OBJECT_SCHEMA_NAME(fk.parent_object_id) = @schema
          AND OBJECT_NAME(fk.parent_object_id) = @table
        ORDER BY fkc.constraint_column_id
      `;
      
      request.input("schema", sql.NVarChar, schema);
      request.input("table", sql.NVarChar, table);
      
      const result = await request.query(fkQuery);
      const foreignKeys: ForeignKeyInfo[] = result.recordset.map(row => ({
        columnName: row.columnName,
        referencedSchema: row.referencedSchema,
        referencedTable: row.referencedTable,
        referencedColumn: row.referencedColumn,
        constraintName: row.constraintName
      }));
      
      if (foreignKeys.length > 0) {
        console.log(`[GenerateSyntheticDataTool] Detected ${foreignKeys.length} foreign key(s) in ${schema}.${table}`);
        foreignKeys.forEach(fk => {
          console.log(`  - ${fk.columnName} → ${fk.referencedSchema}.${fk.referencedTable}.${fk.referencedColumn}`);
        });
      }
      
      return foreignKeys;
      
    } catch (error: any) {
      console.error(`[GenerateSyntheticDataTool] Failed to detect foreign keys:`, error);
      return []; // Return empty array on error
    }
  }
  
  /**
   * Sample parent IDs for a foreign key relationship (Phase 2: Relationship Awareness)
   */
  private async sampleParentIDs(
    parentSchema: string,
    parentTable: string,
    parentColumn: string,
    sampleSize: number,
    context?: ToolContext
  ): Promise<any[]> {
    try {
      let request: sql.Request;
      
      // Get connection pool (respects RLS - only samples IDs user can see)
      if (isValidAuthContext(context) && context) {
        const userId = context.userIdentity.oid || context.userIdentity.userId;
        const pool = await context.poolManager.getPoolForUser(
          userId,
          context.userIdentity.sqlToken!,
          context.userIdentity.tokenExpiry!
        );
        request = pool.request();
      } else {
        request = new sql.Request();
      }
      
      // Query to sample parent IDs
      const parentQuery = `
        SELECT DISTINCT TOP ${sampleSize} [${parentColumn}]
        FROM [${parentSchema}].[${parentTable}]
        WHERE [${parentColumn}] IS NOT NULL
        ORDER BY NEWID()  -- Random sampling
      `;
      
      console.log(`[GenerateSyntheticDataTool] Sampling up to ${sampleSize} parent IDs from ${parentSchema}.${parentTable}.${parentColumn}`);
      const result = await request.query(parentQuery);
      
      const parentIDs = result.recordset.map(row => row[parentColumn]);
      
      if (parentIDs.length === 0) {
        console.warn(`[GenerateSyntheticDataTool] No parent IDs found in ${parentSchema}.${parentTable}.${parentColumn} - FK will be skipped`);
        return [];
      }
      
      console.log(`[GenerateSyntheticDataTool] Sampled ${parentIDs.length} parent ID(s) from ${parentSchema}.${parentTable}.${parentColumn}`);
      return parentIDs;
      
    } catch (error: any) {
      console.error(`[GenerateSyntheticDataTool] Failed to sample parent IDs:`, error);
      return []; // Return empty array on error
    }
  }
  
  /**
   * Generate value from samples (Phase 1: Sample-Based Learning)
   */
  private generateFromSample(
    column: ColumnSchema, 
    index: number, 
    sampleData: SampleData, 
    profile: string
  ): any {
    const samples = sampleData[column.name];
    
    // If no samples for this column, fall back to pattern-based
    if (!samples || samples.length === 0) {
      return this.generateValue(column, index, profile);
    }
    
    const colType = column.type.toLowerCase();
    
    // String columns: Learn vocabulary and generate variations
    if (['varchar', 'nvarchar', 'char', 'nchar', 'text', 'ntext'].includes(colType)) {
      return this.generateStringFromSamples(samples, index, column.maxLength || 50);
    }
    
    // Numeric columns: Learn distribution and generate within range
    if (['int', 'bigint', 'smallint', 'tinyint', 'decimal', 'numeric', 'float', 'real', 'money'].includes(colType)) {
      return this.generateNumericFromSamples(samples);
    }
    
    // Date columns: Learn date range and generate within it
    if (['datetime', 'datetime2', 'date'].includes(colType)) {
      return this.generateDateFromSamples(samples);
    }
    
    // Boolean: Learn distribution
    if (colType === 'bit') {
      const trueCount = samples.filter(s => s === true || s === 1).length;
      const probability = trueCount / samples.length;
      return Math.random() < probability ? 1 : 0;
    }
    
    // For other types, pick random sample
    return samples[Math.floor(Math.random() * samples.length)];
  }
  
  /**
   * Generate string from samples with intelligent variations
   */
  private generateStringFromSamples(samples: any[], index: number, maxLength: number): string {
    // Extract words/tokens from samples
    const tokens = new Set<string>();
    samples.forEach(sample => {
      if (typeof sample === 'string') {
        // Split on spaces, hyphens, underscores
        const words = sample.split(/[\s\-_]+/);
        words.forEach(word => {
          if (word.length > 0) {
            tokens.add(word);
          }
        });
      }
    });
    
    if (tokens.size === 0) {
      // No tokens found, pick random sample
      return samples[Math.floor(Math.random() * samples.length)];
    }
    
    const tokenArray = Array.from(tokens);
    
    // Strategy 1: Pick random sample (70% of the time)
    if (Math.random() < 0.7) {
      return samples[Math.floor(Math.random() * samples.length)];
    }
    
    // Strategy 2: Combine tokens to create variations (30% of the time)
    const numTokens = 1 + Math.floor(Math.random() * Math.min(3, tokenArray.length));
    const selectedTokens: string[] = [];
    
    for (let i = 0; i < numTokens; i++) {
      const token = tokenArray[Math.floor(Math.random() * tokenArray.length)];
      if (!selectedTokens.includes(token)) {
        selectedTokens.push(token);
      }
    }
    
    let generated = selectedTokens.join(' ');
    
    // Ensure we don't exceed max length
    if (generated.length > maxLength) {
      generated = generated.substring(0, maxLength);
    }
    
    return generated || samples[0]; // Fallback to first sample if generation fails
  }
  
  /**
   * Generate numeric value from samples (learns distribution)
   */
  private generateNumericFromSamples(samples: any[]): number {
    const numbers = samples.filter(s => typeof s === 'number' && !isNaN(s));
    
    if (numbers.length === 0) {
      return 0;
    }
    
    // Calculate min, max, and mean
    const min = Math.min(...numbers);
    const max = Math.max(...numbers);
    const mean = numbers.reduce((a, b) => a + b, 0) / numbers.length;
    
    // 70% of the time, pick from actual samples
    if (Math.random() < 0.7) {
      return numbers[Math.floor(Math.random() * numbers.length)];
    }
    
    // 30% of the time, generate within learned range
    // Use normal distribution around mean
    const stdDev = Math.sqrt(
      numbers.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / numbers.length
    );
    
    // Generate value using Box-Muller transform for normal distribution
    const u1 = Math.random();
    const u2 = Math.random();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    let generated = mean + z * stdDev;
    
    // Clamp to observed range
    generated = Math.max(min, Math.min(max, generated));
    
    // Round if samples are integers
    const isInteger = numbers.every(n => Number.isInteger(n));
    return isInteger ? Math.round(generated) : parseFloat(generated.toFixed(2));
  }
  
  /**
   * Generate date from samples (learns date range)
   */
  private generateDateFromSamples(samples: any[]): Date {
    const dates = samples
      .map(s => new Date(s))
      .filter(d => d instanceof Date && !isNaN(d.getTime()));
    
    if (dates.length === 0) {
      return new Date();
    }
    
    // 70% of the time, pick from actual samples
    if (Math.random() < 0.7) {
      return dates[Math.floor(Math.random() * dates.length)];
    }
    
    // 30% of the time, generate within learned range
    const timestamps = dates.map(d => d.getTime());
    const minTime = Math.min(...timestamps);
    const maxTime = Math.max(...timestamps);
    
    // Generate random time within range
    const randomTime = minTime + Math.random() * (maxTime - minTime);
    return new Date(randomTime);
  }
  
  /**
   * Add input parameter with appropriate SQL type
   */
  private addInputParameter(request: sql.Request, paramName: string, value: any, column: any) {
    const type = column.type.toLowerCase();
    
    switch (type) {
      case 'int':
        request.input(paramName, sql.Int, value);
        break;
      case 'bigint':
        request.input(paramName, sql.BigInt, value);
        break;
      case 'smallint':
        request.input(paramName, sql.SmallInt, value);
        break;
      case 'tinyint':
        request.input(paramName, sql.TinyInt, value);
        break;
      case 'decimal':
      case 'numeric':
        request.input(paramName, sql.Decimal(column.numericPrecision, column.numericScale), value);
        break;
      case 'float':
        request.input(paramName, sql.Float, value);
        break;
      case 'real':
        request.input(paramName, sql.Real, value);
        break;
      case 'money':
        request.input(paramName, sql.Money, value);
        break;
      case 'bit':
        request.input(paramName, sql.Bit, value);
        break;
      case 'datetime':
        request.input(paramName, sql.DateTime, value);
        break;
      case 'datetime2':
        request.input(paramName, sql.DateTime2, value);
        break;
      case 'date':
        request.input(paramName, sql.Date, value);
        break;
      case 'time':
        request.input(paramName, sql.Time, value);
        break;
      case 'uniqueidentifier':
        request.input(paramName, sql.UniqueIdentifier, value);
        break;
      case 'nvarchar':
        request.input(paramName, sql.NVarChar(column.maxLength || sql.MAX), value);
        break;
      case 'varchar':
        request.input(paramName, sql.VarChar(column.maxLength || sql.MAX), value);
        break;
      case 'nchar':
        request.input(paramName, sql.NChar(column.maxLength), value);
        break;
      case 'char':
        request.input(paramName, sql.Char(column.maxLength), value);
        break;
      case 'text':
        request.input(paramName, sql.Text, value);
        break;
      case 'ntext':
        request.input(paramName, sql.NText, value);
        break;
      default:
        request.input(paramName, sql.NVarChar, value?.toString());
    }
  }
  
  /**
   * Check if value is valid for SQL data type (for filtering parent IDs)
   */
  private isValidForType(value: any, sqlType: string): boolean {
    if (value === null || value === undefined) {
      return false;
    }
    
    const type = sqlType.toLowerCase();
    const numValue = Number(value);
    
    if (isNaN(numValue)) {
      return true; // Non-numeric types, assume valid
    }
    
    // Numeric type constraints
    if (type === 'tinyint') {
      return numValue >= 0 && numValue <= 255 && Number.isInteger(numValue);
    }
    if (type === 'smallint') {
      return numValue >= 0 && numValue <= 65535 && Number.isInteger(numValue);
    }
    if (type === 'int') {
      return numValue >= -2147483648 && numValue <= 2147483647 && Number.isInteger(numValue);
    }
    if (type === 'bigint') {
      return Number.isSafeInteger(numValue);
    }
    
    return true; // Unknown type, assume valid
  }
  
  /**
   * Enforce SQL data type constraints on generated values (for clamping generated data)
   */
  private enforceTypeConstraints(value: any, sqlType: string): any {
    if (value === null || value === undefined) {
      return value;
    }
    
    const type = sqlType.toLowerCase();
    
    // Numeric type constraints
    if (type === 'tinyint') {
      // TINYINT: 0 to 255
      return Math.max(0, Math.min(255, Math.round(value)));
    }
    if (type === 'smallint') {
      // SMALLINT: mssql library expects 0 to 65535 (unsigned)
      return Math.max(0, Math.min(65535, Math.round(value)));
    }
    if (type === 'int') {
      // INT: -2147483648 to 2147483647
      return Math.max(-2147483648, Math.min(2147483647, Math.round(value)));
    }
    if (type === 'bigint') {
      // BIGINT: -9223372036854775808 to 9223372036854775807
      // JavaScript safe integer range
      return Math.max(Number.MIN_SAFE_INTEGER, Math.min(Number.MAX_SAFE_INTEGER, Math.round(value)));
    }
    
    return value;
  }
  
  /**
   * Generate synthetic value based on column metadata
   */
  private generateValue(column: any, index: number, profile: string): any {
    const { type, name, maxLength, nullable } = column;
    const lowerName = name.toLowerCase();
    
    // Handle nullable columns based on profile
    if (nullable === 'YES' && profile === 'edge-cases' && index % 10 === 0) {
      return null; // 10% null values in edge-cases mode
    }
    
    // Type-based generation
    const colType = type.toLowerCase();
    
    switch (colType) {
      case 'int':
      case 'bigint':
      case 'smallint':
      case 'tinyint':
        return this.generateInteger(lowerName, index, profile);
      
      case 'decimal':
      case 'numeric':
      case 'float':
      case 'real':
      case 'money':
        return this.generateDecimal(lowerName, index, profile);
      
      case 'varchar':
      case 'nvarchar':
      case 'char':
      case 'nchar':
      case 'text':
      case 'ntext':
        return this.generateString(lowerName, maxLength, index, profile);
      
      case 'datetime':
      case 'datetime2':
      case 'date':
        return this.generateDate(lowerName, index, profile);
      
      case 'time':
        return this.generateTime(index, profile);
      
      case 'bit':
        return this.generateBoolean(index, profile);
      
      case 'uniqueidentifier':
        return this.generateGuid();
      
      default:
        return `Generated_${index}`;
    }
  }
  
  /**
   * Generate integer values
   */
  private generateInteger(columnName: string, index: number, profile: string): number {
    if (profile === 'edge-cases') {
      const edgeCases = [0, 1, -1, 999999, -999999];
      return edgeCases[index % edgeCases.length];
    }
    
    // Realistic values based on column name
    if (columnName.includes('customerid') || columnName.includes('customer_id')) {
      return 10000 + index;
    }
    if (columnName.includes('age')) {
      return 18 + Math.floor(Math.random() * 70); // 18-88 years
    }
    if (columnName.includes('year')) {
      return 2020 + Math.floor(Math.random() * 5); // 2020-2024
    }
    if (columnName.includes('quantity') || columnName.includes('qty')) {
      return 1 + Math.floor(Math.random() * 100);
    }
    if (columnName.includes('rating') || columnName.includes('score')) {
      return 1 + Math.floor(Math.random() * 5); // 1-5 rating
    }
    
    return Math.floor(Math.random() * 10000);
  }
  
  /**
   * Generate decimal values
   */
  private generateDecimal(columnName: string, index: number, profile: string): number {
    if (profile === 'edge-cases') {
      const edgeCases = [0.00, 0.01, 999.99, -999.99];
      return edgeCases[index % edgeCases.length];
    }
    
    // Realistic values based on column name
    if (columnName.includes('price') || columnName.includes('cost') || columnName.includes('amount')) {
      return parseFloat((Math.random() * 1000).toFixed(2));
    }
    if (columnName.includes('tax') || columnName.includes('discount')) {
      return parseFloat((Math.random() * 100).toFixed(2));
    }
    if (columnName.includes('weight')) {
      return parseFloat((Math.random() * 50).toFixed(2));
    }
    if (columnName.includes('latitude') || columnName.includes('lat')) {
      return parseFloat(((Math.random() * 180) - 90).toFixed(6));
    }
    if (columnName.includes('longitude') || columnName.includes('lon') || columnName.includes('lng')) {
      return parseFloat(((Math.random() * 360) - 180).toFixed(6));
    }
    
    return parseFloat((Math.random() * 1000).toFixed(2));
  }
  
  /**
   * Generate string values
   */
  private generateString(columnName: string, maxLength: number, index: number, profile: string): string {
    const length = Math.min(maxLength || 50, 200);
    
    if (profile === 'edge-cases') {
      const edgeCases = ['', 'A', 'a'.repeat(Math.min(length, 10)), `Test'Quote"`, 'null', 'undefined'];
      return edgeCases[index % edgeCases.length];
    }
    
    // Realistic values based on column name
    if (profile === 'realistic') {
      // Names
      if (columnName.includes('firstname') || columnName.includes('first_name') || columnName.includes('fname')) {
        const names = ['James', 'Mary', 'John', 'Patricia', 'Robert', 'Jennifer', 'Michael', 'Linda', 
                       'William', 'Barbara', 'David', 'Elizabeth', 'Richard', 'Susan', 'Joseph', 'Jessica',
                       'Thomas', 'Sarah', 'Charles', 'Karen', 'Christopher', 'Nancy', 'Daniel', 'Lisa'];
        return names[index % names.length];
      }
      
      if (columnName.includes('lastname') || columnName.includes('last_name') || columnName.includes('lname')) {
        const names = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis',
                       'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez', 'Wilson', 'Anderson',
                       'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin', 'Lee', 'Perez', 'Thompson'];
        return names[index % names.length];
      }
      
      if (columnName.includes('middlename') || columnName.includes('middle_name')) {
        const names = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'J', 'K', 'L', 'M'];
        return names[index % names.length];
      }
      
      // Contact information
      if (columnName.includes('email')) {
        const domains = ['example.com', 'test.com', 'demo.com', 'sample.org', 'company.net'];
        return `user${index}@${domains[index % domains.length]}`;
      }
      
      if (columnName.includes('phone') || columnName.includes('telephone') || columnName.includes('mobile')) {
        const areaCode = 200 + Math.floor(Math.random() * 800);
        const prefix = 200 + Math.floor(Math.random() * 800);
        const lineNum = 1000 + Math.floor(Math.random() * 9000);
        return `${areaCode}-${prefix}-${lineNum}`;
      }
      
      // Addresses
      if (columnName.includes('address') || columnName.includes('street')) {
        const numbers = 100 + Math.floor(Math.random() * 9900);
        const streets = ['Main St', 'Oak Ave', 'Maple Dr', 'Park Ln', 'Washington Blvd', 'Lake Rd', 'Cedar Way'];
        return `${numbers} ${streets[index % streets.length]}`;
      }
      
      if (columnName.includes('city')) {
        const cities = ['New York', 'Los Angeles', 'Chicago', 'Houston', 'Phoenix', 'Philadelphia', 
                       'San Antonio', 'San Diego', 'Dallas', 'San Jose', 'Austin', 'Jacksonville',
                       'Fort Worth', 'Columbus', 'Charlotte', 'San Francisco', 'Indianapolis', 'Seattle'];
        return cities[index % cities.length];
      }
      
      if (columnName.includes('state') || columnName.includes('province')) {
        const states = ['CA', 'TX', 'FL', 'NY', 'PA', 'IL', 'OH', 'GA', 'NC', 'MI', 'NJ', 'VA', 'WA', 'AZ', 'MA'];
        return states[index % states.length];
      }
      
      if (columnName.includes('zip') || columnName.includes('postal')) {
        return String(10000 + Math.floor(Math.random() * 90000)).padStart(5, '0');
      }
      
      if (columnName.includes('country')) {
        const countries = ['USA', 'Canada', 'UK', 'Germany', 'France', 'Spain', 'Italy', 'Australia', 'Japan'];
        return countries[index % countries.length];
      }
      
      // Business information
      if (columnName.includes('company') || columnName.includes('organization')) {
        const companies = ['Acme Corp', 'TechStart Inc', 'Global Solutions', 'Innovation Labs', 
                          'Digital Ventures', 'Prime Industries', 'Apex Systems', 'NextGen Tech'];
        return companies[index % companies.length];
      }
      
      if (columnName.includes('title') || columnName.includes('jobtitle') || columnName.includes('position')) {
        const titles = ['Manager', 'Director', 'Engineer', 'Analyst', 'Coordinator', 'Specialist', 
                       'Consultant', 'Administrator', 'Developer', 'Designer'];
        return titles[index % titles.length];
      }
      
      if (columnName.includes('department') || columnName.includes('dept')) {
        const departments = ['Sales', 'Marketing', 'Engineering', 'HR', 'Finance', 'Operations', 'IT', 'Support'];
        return departments[index % departments.length];
      }
      
      // Products/Items
      if (columnName.includes('product') || columnName.includes('item')) {
        return `Product-${String(index).padStart(4, '0')}`;
      }
      
      if (columnName.includes('sku') || columnName.includes('code')) {
        return `SKU-${String(index).padStart(6, '0')}`;
      }
      
      if (columnName.includes('description') || columnName.includes('notes') || columnName.includes('comment')) {
        const descriptions = [
          'High quality product with excellent features',
          'Standard model suitable for everyday use',
          'Premium version with advanced capabilities',
          'Entry level option for budget-conscious buyers',
          'Professional grade equipment for demanding applications'
        ];
        return descriptions[index % descriptions.length];
      }
      
      if (columnName.includes('status')) {
        const statuses = ['Active', 'Pending', 'Completed', 'Cancelled', 'In Progress'];
        return statuses[index % statuses.length];
      }
      
      if (columnName.includes('category') || columnName.includes('type')) {
        const categories = ['Type A', 'Type B', 'Type C', 'Standard', 'Premium', 'Basic', 'Advanced'];
        return categories[index % categories.length];
      }
    }
    
    // Random string fallback
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    const targetLength = Math.min(length, 20);
    for (let i = 0; i < targetLength; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result || `Value_${index}`;
  }
  
  /**
   * Generate date values
   */
  private generateDate(columnName: string, index: number, profile: string): Date {
    const now = new Date();
    
    if (profile === 'edge-cases') {
      const edgeCases = [
        new Date('1900-01-01'),
        new Date('1970-01-01'),
        new Date('2000-01-01'),
        now,
        new Date('2099-12-31')
      ];
      return edgeCases[index % edgeCases.length];
    }
    
    // Realistic dates based on column name
    if (columnName.includes('birth') || columnName.includes('dob')) {
      // Birth dates: 18-80 years ago
      const yearsAgo = 18 + Math.floor(Math.random() * 62);
      const date = new Date(now.getFullYear() - yearsAgo, Math.floor(Math.random() * 12), Math.floor(Math.random() * 28) + 1);
      return date;
    }
    
    if (columnName.includes('created') || columnName.includes('registered') || columnName.includes('joined')) {
      // Recent dates: last 2 years
      const daysAgo = Math.floor(Math.random() * 730);
      return new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);
    }
    
    if (columnName.includes('modified') || columnName.includes('updated') || columnName.includes('changed')) {
      // Very recent: last 90 days
      const daysAgo = Math.floor(Math.random() * 90);
      return new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);
    }
    
    if (columnName.includes('expire') || columnName.includes('expiration') || columnName.includes('end')) {
      // Future dates: next 1-5 years
      const daysAhead = Math.floor(Math.random() * 1825);
      return new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);
    }
    
    // Default: random date within last year
    const daysAgo = Math.floor(Math.random() * 365);
    return new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);
  }
  
  /**
   * Generate time values
   */
  private generateTime(index: number, profile: string): Date {
    if (profile === 'edge-cases') {
      const times = ['00:00:00', '12:00:00', '23:59:59'];
      return new Date(`1970-01-01T${times[index % times.length]}`);
    }
    
    // Business hours: 8 AM - 6 PM
    const hour = 8 + Math.floor(Math.random() * 10);
    const minute = Math.floor(Math.random() * 60);
    const second = Math.floor(Math.random() * 60);
    return new Date(`1970-01-01T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`);
  }
  
  /**
   * Generate boolean values
   */
  private generateBoolean(index: number, profile: string): number {
    if (profile === 'edge-cases') {
      return index % 2; // Alternating 0 and 1
    }
    return Math.random() > 0.5 ? 1 : 0;
  }
  
  /**
   * Generate GUID values
   */
  private generateGuid(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }
}
