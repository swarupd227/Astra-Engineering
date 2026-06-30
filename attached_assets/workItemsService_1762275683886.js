import axios from 'axios';

class WorkItemsService {
  constructor() {
    this.baseURL = 'https://dev.azure.com/DevXPlatform';
    this.project = 'NousAugmentedDevX';
    this.token = 'REDACTED_TOKEN';
    this.apiVersion = '7.0';
    this.client = null;
    this.initialized = false;
  }

  initialize() {
    if (this.initialized) return;
    
    this.client = axios.create({
      baseURL: `${this.baseURL}/${this.project}/_apis`,
      headers: {
        'Authorization': `Basic ${btoa(`:${this.token}`)}`,
        'Content-Type': 'application/json'
      },
      timeout: 30000
    });

    // Add request interceptor for logging
    this.client.interceptors.request.use(
      (config) => {
        console.log('Making work items API request:', config.method.toUpperCase(), config.url);
        return config;
      },
      (error) => {
        console.error('Work items request error:', error);
        return Promise.reject(error);
      }
    );

    // Add response interceptor for logging
    this.client.interceptors.response.use(
      (response) => {
        console.log('Work items API response:', response.status, response.config.url);
        return response;
      },
      (error) => {
        console.error('Work items API error:', error.response?.status, error.response?.data || error.message, error.config?.url);
        return Promise.reject(error);
      }
    );

    this.initialized = true;
    console.log('Work Items Service initialized successfully');
  }

  _checkInitialized() {
    if (!this.initialized || !this.client) {
      throw new Error('Work Items Service not initialized. Call initialize() first.');
    }
  }

  // Test connection
  async testConnection() {
    this._checkInitialized();
    try {
      console.log('Testing work items service connection...');
      const response = await this.client.get(`/projects/${this.project}?api-version=${this.apiVersion}`);
      
      const project = response.data;
      console.log(`✅ Work items service connected successfully to project: ${project.name}`);
      
      return {
        success: true,
        project: project.name,
        message: `Successfully connected to project: ${project.name}`
      };
    } catch (error) {
      console.error('Work items service connection test failed:', error);
      return {
        success: false,
        message: `Connection failed: ${error.message}`
      };
    }
  }

  // Get all work items
  async getWorkItems(top = 100, skip = 0) {
    this._checkInitialized();
    try {
      console.log(`Fetching work items (top: ${top}, skip: ${skip})...`);
      
      // First get work item IDs using WIQL
      const wiqlQuery = {
        query: `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = '${this.project}' ORDER BY [System.ChangedDate] DESC`
      };
      
      const idsResponse = await this.client.post(`/wit/wiql?api-version=${this.apiVersion}`, wiqlQuery);
      
      const workItemIds = idsResponse.data.workItems?.map(item => item.id) || [];
      
      if (workItemIds.length === 0) {
        console.log('No work items found');
        return [];
      }
      
      // Get work item details in batches
      const batchSize = 200; // Azure DevOps supports up to 200 items per batch
      const batches = [];
      
      for (let i = 0; i < workItemIds.length; i += batchSize) {
        const batch = workItemIds.slice(i, i + batchSize);
        batches.push(batch);
      }
      
      const allWorkItems = [];
      
      for (const batch of batches) {
        const response = await this.client.get(`/wit/workitems?ids=${batch.join(',')}&api-version=${this.apiVersion}&$expand=all`);
        const workItems = response.data.value || [];
        allWorkItems.push(...workItems);
      }
      
      console.log(`✅ Successfully fetched ${allWorkItems.length} work items`);
      return allWorkItems;
    } catch (error) {
      console.error('Error fetching work items:', error);
      throw error;
    }
  }

  // Get work items by query
  async getWorkItemsByQuery(query) {
    this._checkInitialized();
    try {
      console.log('Executing work items query...', query);
      
      const response = await this.client.post(`/wit/wiql?api-version=${this.apiVersion}`, {
        query: query
      });
      
      const workItemIds = response.data.workItems?.map(item => item.id) || [];
      
      if (workItemIds.length === 0) {
        console.log('No work items found for query');
        return [];
      }
      
      // Get work item details
      const response2 = await this.client.get(`/wit/workitems?ids=${workItemIds.join(',')}&api-version=${this.apiVersion}&$expand=all`);
      
      const workItems = response2.data.value || [];
      console.log(`✅ Successfully fetched ${workItems.length} work items for query`);
      
      return workItems;
    } catch (error) {
      console.error('Error executing work items query:', error);
      throw error;
    }
  }

  // Get work item by ID
  async getWorkItemById(workItemId) {
    this._checkInitialized();
    try {
      console.log(`Fetching work item ${workItemId}...`);
      
      const response = await this.client.get(`/wit/workitems/${workItemId}?api-version=${this.apiVersion}&$expand=all`);
      
      const workItem = response.data;
      console.log(`✅ Successfully fetched work item: ${workItem.fields['System.Title']}`);
      
      return workItem;
    } catch (error) {
      console.error(`Error fetching work item ${workItemId}:`, error);
      throw error;
    }
  }

  // Create a new work item
  async createWorkItem(workItemType, fields) {
    this._checkInitialized();
    try {
      console.log(`Creating ${workItemType} work item...`, fields);
      
      // Convert fields to JSON Patch format
      const patchOperations = Object.entries(fields).map(([path, value]) => ({
        op: 'add',
        path: `/fields/${path}`,
        value: value
      }));
      
      const encodedWorkItemType = encodeURIComponent(`$${workItemType}`);
      const response = await this.client.post(`/wit/workitems/${encodedWorkItemType}?api-version=${this.apiVersion}`, patchOperations, {
        headers: {
          'Content-Type': 'application/json-patch+json'
        }
      });
      
      const workItem = response.data;
      console.log(`✅ Successfully created work item: ${workItem.fields['System.Title']} (ID: ${workItem.id})`);
      
      return workItem;
    } catch (error) {
      console.error(`Error creating ${workItemType} work item:`, error);
      throw error;
    }
  }

  // Create work item with simplified fields
  async createWorkItemSimple(workItemType, title, description = '', assignedTo = '', priority = 2) {
    this._checkInitialized();
    try {
      console.log(`Creating ${workItemType} work item with title: ${title}`);
      
      const fields = {
        'System.Title': title,
        'System.Description': description,
        'Microsoft.VSTS.Common.Priority': priority
      };
      
      if (assignedTo) {
        fields['System.AssignedTo'] = assignedTo;
      }
      
      return await this.createWorkItem(workItemType, fields);
    } catch (error) {
      console.error(`Error creating ${workItemType} work item:`, error);
      throw error;
    }
  }

  // Create work item with parent relationship
  async createWorkItemWithParent(workItemType, title, description = '', assignedTo = '', priority = 2, parentId = null) {
    this._checkInitialized();
    try {
      console.log(`Creating ${workItemType} work item with title: ${title}${parentId ? ` (parent: ${parentId})` : ''}`);
      
      const fields = {
        'System.Title': title,
        'System.Description': description,
        'Microsoft.VSTS.Common.Priority': priority
      };
      
      if (assignedTo) {
        fields['System.AssignedTo'] = assignedTo;
      }
      
      const workItem = await this.createWorkItem(workItemType, fields);
      
      // If parent is specified, create the parent-child relationship
      if (parentId) {
        await this.linkWorkItems(parentId, workItem.id, 'Parent');
      }
      
      return workItem;
    } catch (error) {
      console.error(`Error creating ${workItemType} work item with parent:`, error);
      throw error;
    }
  }

  // Link work items with a specific relationship type
  async linkWorkItems(sourceWorkItemId, targetWorkItemId, relationshipType = 'Parent') {
    this._checkInitialized();
    try {
      console.log(`Linking work item ${sourceWorkItemId} to ${targetWorkItemId} with relationship: ${relationshipType}`);
      
      const patchOperations = [{
        op: 'add',
        path: '/relations/-',
        value: {
          rel: relationshipType.toLowerCase(),
          url: `${this.baseURL}/${this.project}/_apis/wit/workitems/${targetWorkItemId}`,
          attributes: {
            comment: `Linked via ${relationshipType} relationship`
          }
        }
      }];
      
      const response = await this.client.patch(`/wit/workitems/${sourceWorkItemId}?api-version=${this.apiVersion}`, patchOperations, {
        headers: {
          'Content-Type': 'application/json-patch+json'
        }
      });
      
      console.log(`✅ Successfully linked work items: ${sourceWorkItemId} -> ${targetWorkItemId}`);
      return response.data;
    } catch (error) {
      console.error(`Error linking work items:`, error);
      throw error;
    }
  }

  // Get work item hierarchy (parent and children)
  async getWorkItemHierarchy(workItemId) {
    this._checkInitialized();
    try {
      console.log(`Fetching hierarchy for work item ${workItemId}...`);
      
      const response = await this.client.get(`/wit/workitems/${workItemId}?api-version=${this.apiVersion}&$expand=all`);
      const workItem = response.data;
      
      const hierarchy = {
        workItem: workItem,
        parent: null,
        children: []
      };
      
      // Get parent work item if exists
      if (workItem.relations) {
        const parentRelation = workItem.relations.find(rel => rel.rel === 'parent');
        if (parentRelation) {
          const parentId = parentRelation.url.split('/').pop();
          hierarchy.parent = await this.getWorkItemById(parentId);
        }
      }
      
      // Get child work items
      const childrenQuery = {
        query: `SELECT [System.Id] FROM WorkItems WHERE [System.Parent] = ${workItemId}`
      };
      
      try {
        const childrenResponse = await this.client.post(`/wit/wiql?api-version=${this.apiVersion}`, childrenQuery);
        const childIds = childrenResponse.data.workItems?.map(item => item.id) || [];
        
        if (childIds.length > 0) {
          const childrenResponse2 = await this.client.get(`/wit/workitems?ids=${childIds.join(',')}&api-version=${this.apiVersion}&$expand=all`);
          hierarchy.children = childrenResponse2.data.value || [];
        }
      } catch (error) {
        console.log('No children found or error fetching children:', error.message);
      }
      
      console.log(`✅ Successfully fetched hierarchy for work item ${workItemId}`);
      return hierarchy;
    } catch (error) {
      console.error(`Error fetching hierarchy for work item ${workItemId}:`, error);
      throw error;
    }
  }

  // Get all work items with hierarchy information
  async getWorkItemsWithHierarchy(top = 100, skip = 0) {
    this._checkInitialized();
    try {
      console.log(`Fetching work items with hierarchy (top: ${top}, skip: ${skip})...`);
      
      // First get work item IDs using WIQL
      const wiqlQuery = {
        query: `SELECT [System.Id], [System.Parent] FROM WorkItems WHERE [System.TeamProject] = '${this.project}' ORDER BY [System.ChangedDate] DESC`
      };
      
      const idsResponse = await this.client.post(`/wit/wiql?api-version=${this.apiVersion}`, wiqlQuery);
      
      const workItemIds = idsResponse.data.workItems?.map(item => item.id) || [];
      
      if (workItemIds.length === 0) {
        console.log('No work items found');
        return [];
      }
      
      // Get work item details in batches
      const batchSize = 200;
      const batches = [];
      
      for (let i = 0; i < workItemIds.length; i += batchSize) {
        const batch = workItemIds.slice(i, i + batchSize);
        batches.push(batch);
      }
      
      const allWorkItems = [];
      
      for (const batch of batches) {
        const response = await this.client.get(`/wit/workitems?ids=${batch.join(',')}&api-version=${this.apiVersion}&$expand=all`);
        const workItems = response.data.value || [];
        allWorkItems.push(...workItems);
      }
      
      // Add hierarchy information to each work item
      const workItemsWithHierarchy = allWorkItems.map(item => {
        const parentRelation = item.relations?.find(rel => rel.rel === 'parent');
        const parentId = parentRelation ? parentRelation.url.split('/').pop() : null;
        
        return {
          ...item,
          hierarchy: {
            parentId: parentId,
            hasChildren: false // Will be populated separately if needed
          }
        };
      });
      
      console.log(`✅ Successfully fetched ${workItemsWithHierarchy.length} work items with hierarchy info`);
      return workItemsWithHierarchy;
    } catch (error) {
      console.error('Error fetching work items with hierarchy:', error);
      throw error;
    }
  }

  // Update work item
  async updateWorkItem(workItemId, updates) {
    this._checkInitialized();
    try {
      console.log(`Updating work item ${workItemId}...`, updates);
      
      // Convert updates to JSON Patch format
      const patchOperations = Object.entries(updates).map(([path, value]) => ({
        op: 'replace',
        path: `/fields/${path}`,
        value: value
      }));
      
      const response = await this.client.patch(`/wit/workitems/${workItemId}?api-version=${this.apiVersion}`, patchOperations, {
        headers: {
          'Content-Type': 'application/json-patch+json'
        }
      });
      
      const workItem = response.data;
      console.log(`✅ Successfully updated work item: ${workItem.fields['System.Title']}`);
      
      return workItem;
    } catch (error) {
      console.error(`Error updating work item ${workItemId}:`, error);
      throw error;
    }
  }

  // Update work item status
  async updateWorkItemStatus(workItemId, newStatus) {
    this._checkInitialized();
    try {
      console.log(`Updating work item ${workItemId} status to: ${newStatus}`);
      
      const patchOperations = [{
        op: 'replace',
        path: '/fields/System.State',
        value: newStatus
      }];
      
      const response = await this.client.patch(`/wit/workitems/${workItemId}?api-version=${this.apiVersion}`, patchOperations, {
        headers: {
          'Content-Type': 'application/json-patch+json'
        }
      });
      
      const workItem = response.data;
      console.log(`✅ Successfully updated work item status: ${workItem.fields['System.Title']} -> ${newStatus}`);
      
      return workItem;
    } catch (error) {
      console.error(`Error updating work item ${workItemId} status:`, error);
      
      // Provide more helpful error messages for common state transition issues
      if (error.response?.status === 400) {
        const errorMessage = error.response.data?.message || error.message;
        if (errorMessage.includes('not in the list of supported values')) {
          throw new Error(`The state '${newStatus}' is not valid for this work item type. Please check the available states for this work item.`);
        }
      }
      
      throw error;
    }
  }

  // Update work item assignment
  async updateWorkItemAssignment(workItemId, assignedTo) {
    this._checkInitialized();
    try {
      console.log(`Updating work item ${workItemId} assignment to: ${assignedTo}`);
      
      const patchOperations = [{
        op: 'replace',
        path: '/fields/System.AssignedTo',
        value: assignedTo
      }];
      
      const response = await this.client.patch(`/wit/workitems/${workItemId}?api-version=${this.apiVersion}`, patchOperations, {
        headers: {
          'Content-Type': 'application/json-patch+json'
        }
      });
      
      const workItem = response.data;
      console.log(`✅ Successfully updated work item assignment: ${workItem.fields['System.Title']} -> ${assignedTo}`);
      
      return workItem;
    } catch (error) {
      console.error(`Error updating work item ${workItemId} assignment:`, error);
      throw error;
    }
  }

  // Delete work item
  async deleteWorkItem(workItemId) {
    this._checkInitialized();
    try {
      console.log(`Deleting work item ${workItemId}...`);
      
      // First get the work item to log its title
      const workItem = await this.getWorkItemById(workItemId);
      const title = workItem.fields['System.Title'];
      
      // Delete the work item
      await this.client.delete(`/wit/workitems/${workItemId}?api-version=${this.apiVersion}`);
      
      console.log(`✅ Successfully deleted work item: ${title} (ID: ${workItemId})`);
      return true;
    } catch (error) {
      console.error(`Error deleting work item ${workItemId}:`, error);
      throw error;
    }
  }

  // Bulk update work items
  async bulkUpdateWorkItems(workItemIds, updates) {
    this._checkInitialized();
    try {
      console.log(`Bulk updating ${workItemIds.length} work items...`, updates);
      
      const results = [];
      
      for (const workItemId of workItemIds) {
        try {
          const result = await this.updateWorkItem(workItemId, updates);
          results.push({ id: workItemId, success: true, workItem: result });
        } catch (error) {
          console.error(`Failed to update work item ${workItemId}:`, error);
          results.push({ id: workItemId, success: false, error: error.message });
        }
      }
      
      const successCount = results.filter(r => r.success).length;
      console.log(`✅ Bulk update completed: ${successCount}/${workItemIds.length} successful`);
      
      return results;
    } catch (error) {
      console.error('Error in bulk update:', error);
      throw error;
    }
  }

  // Get work item types
  async getWorkItemTypes() {
    this._checkInitialized();
    try {
      console.log('Fetching work item types...');
      
      const response = await this.client.get(`/wit/workitemtypes?api-version=${this.apiVersion}`);
      
      const workItemTypes = response.data.value || [];
      console.log(`✅ Successfully fetched ${workItemTypes.length} work item types`);
      
      return workItemTypes;
    } catch (error) {
      console.error('Error fetching work item types:', error);
      throw error;
    }
  }

  // Get work item states
  async getWorkItemStates(workItemType) {
    this._checkInitialized();
    try {
      console.log(`Fetching states for work item type: ${workItemType}...`);
      
      const response = await this.client.get(`/wit/workitemtypes/${workItemType}?api-version=${this.apiVersion}`);
      
      const states = response.data.states || [];
      console.log(`✅ Successfully fetched ${states.length} states for ${workItemType}`);
      
      return states;
    } catch (error) {
      console.error(`Error fetching states for ${workItemType}:`, error);
      throw error;
    }
  }

  // Get work item fields
  async getWorkItemFields() {
    this._checkInitialized();
    try {
      console.log('Fetching work item fields...');
      
      const response = await this.client.get(`/wit/fields?api-version=${this.apiVersion}`);
      
      const fields = response.data.value || [];
      console.log(`✅ Successfully fetched ${fields.length} work item fields`);
      
      return fields;
    } catch (error) {
      console.error('Error fetching work item fields:', error);
      throw error;
    }
  }

  // Get work item queries
  async getWorkItemQueries() {
    this._checkInitialized();
    try {
      console.log('Fetching work item queries...');
      
      const response = await this.client.get(`/wit/queries?api-version=${this.apiVersion}&$expand=all`);
      
      const queries = response.data.value || [];
      console.log(`✅ Successfully fetched ${queries.length} work item queries`);
      
      return queries;
    } catch (error) {
      console.error('Error fetching work item queries:', error);
      throw error;
    }
  }

  // Get work item statistics
  async getWorkItemStats() {
    this._checkInitialized();
    try {
      console.log('Fetching work item statistics...');
      
      // Get all work items first, then calculate statistics
      const allWorkItems = await this.getWorkItems(1000); // Get up to 1000 work items for stats
      
      const stats = {
        total: allWorkItems.length,
        bugs: 0,
        tasks: 0,
        userStories: 0,
        epics: 0,
        features: 0,
        active: 0,
        closed: 0,
        new: 0,
        resolved: 0
      };
      
      // Calculate statistics from the work items
      allWorkItems.forEach(item => {
        const workItemType = item.fields?.['System.WorkItemType'];
        const state = item.fields?.['System.State'];
        
        // Count by type
        switch (workItemType) {
          case 'Bug':
            stats.bugs++;
            break;
          case 'Task':
            stats.tasks++;
            break;
          case 'User Story':
            stats.userStories++;
            break;
          case 'Epic':
            stats.epics++;
            break;
          case 'Feature':
            stats.features++;
            break;
        }
        
        // Count by state
        switch (state) {
          case 'Active':
            stats.active++;
            break;
          case 'Closed':
          case 'Done':
            stats.closed++;
            break;
          case 'New':
            stats.new++;
            break;
          case 'Resolved':
            stats.resolved++;
            break;
        }
      });
      
      console.log('✅ Successfully fetched work item statistics');
      return stats;
    } catch (error) {
      console.error('Error fetching work item statistics:', error);
      throw error;
    }
  }

  // Update configuration
  updateConfig(newConfig) {
    this.baseURL = newConfig.organization || this.baseURL;
    this.project = newConfig.project || this.project;
    this.token = newConfig.token || this.token;
    this.apiVersion = newConfig.apiVersion || this.apiVersion;
    this.initialized = false; // Re-initialize client with new config
    this.initialize();
  }
}

// Export singleton instance
const workItemsService = new WorkItemsService();
export default workItemsService;
