// Global variables
let jsonData = null;
let allNodes = []; // Store all nodes (Neo4j-style graph data)
let allEdges = []; // Store all edges (relationships in Neo4j style)
let network = null; // vis.js Network instance
let data = null; // vis.js DataSet for nodes and edges
let nodesDataSet = null;
let edgesDataSet = null;
let maxInitialDepth = 3; // Limit initial depth
let expandedNodes = new Set(); // Track expanded nodes
let focusedNodeId = null; // Currently focused node for drill-down
let navigationStack = []; // Stack of node IDs for back navigation
let nodeJsonPath = new Map(); // Map node ID to JSON path for highlighting
let selectedResourceType = null; // Currently selected resourceType filter
let resourceTypeColors = new Map(); // Color mapping for each resourceType
let isCleared = false; // Whether the view has been cleared
let searchHighlightedNodes = new Set(); // Nodes highlighted by search

// DOM elements
const fileInput = document.getElementById('fileInput');
const uploadBtn = document.getElementById('uploadBtn');
const jsonEditor = document.getElementById('jsonEditor');
const visualizeBtn = document.getElementById('visualizeBtn');
const validIndicator = document.getElementById('validIndicator');
const vizContainer = document.getElementById('vizContainer');
const zoomInBtn = document.getElementById('zoomInBtn');
const zoomOutBtn = document.getElementById('zoomOutBtn');
const fitViewBtn = document.getElementById('fitViewBtn');
const searchInput = document.getElementById('searchInput');
const maxDepthInput = document.getElementById('maxDepthInput');
const backBtn = document.getElementById('backBtn');

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    setupEventListeners();
    initializeVisualization();
    // Auto-visualize the sample JSON
    validateJSON();
    if (isValidJSON()) {
        visualizeJSON();
    }
});

function setupEventListeners() {
    uploadBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', handleFileUpload);
    jsonEditor.addEventListener('input', validateJSON);
    visualizeBtn.addEventListener('click', visualizeJSON);
    zoomInBtn.addEventListener('click', () => zoomIn());
    zoomOutBtn.addEventListener('click', () => zoomOut());
    fitViewBtn.addEventListener('click', fitToView);
    searchInput.addEventListener('input', handleSearch);
    maxDepthInput.addEventListener('change', () => {
        maxInitialDepth = parseInt(maxDepthInput.value) || 3;
        if (jsonData) {
            buildGraph(jsonData);
            renderGraph();
        }
    });
    backBtn.addEventListener('click', navigateBack);
    
    // Allow drag and drop
    jsonEditor.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
    });
    
    jsonEditor.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const file = e.dataTransfer.files[0];
        if (file && file.type === 'application/json') {
            readFile(file);
        }
    });
}

function handleFileUpload(e) {
    const file = e.target.files[0];
    if (file) {
        readFile(file);
    }
}

function readFile(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
        jsonEditor.value = e.target.result;
        validateJSON();
        if (isValidJSON()) {
            visualizeJSON();
        }
    };
    reader.readAsText(file);
}

function validateJSON() {
    try {
        JSON.parse(jsonEditor.value);
        validIndicator.textContent = 'Valid JSON';
        validIndicator.className = 'indicator';
        return true;
    } catch (e) {
        validIndicator.textContent = 'Invalid JSON';
        validIndicator.className = 'indicator invalid';
        return false;
    }
}

function isValidJSON() {
    try {
        JSON.parse(jsonEditor.value);
        return true;
    } catch (e) {
        return false;
    }
}

function visualizeJSON() {
    if (!validateJSON()) {
        return;
    }
    
    try {
        const jsonText = jsonEditor.value;
        const fileSizeMB = new Blob([jsonText]).size / (1024 * 1024);
        
        // Reset all state for a fresh build
        allNodes = [];
        allEdges = [];
        nodeJsonPath.clear();
        nodeIdCounter = 0;
        edgeIdCounter = 0;
        expandedNodes.clear();
        focusedNodeId = null;
        navigationStack = [];
        selectedResourceType = null;
        lastExpandedResourceType = null;
        isCleared = false;
        resourceTypeColors.clear();
        searchHighlightedNodes.clear();
        updateBackButtonVisibility();
        
        // Clear the visualization
        if (nodesDataSet) {
            nodesDataSet.clear();
        }
        if (edgesDataSet) {
            edgesDataSet.clear();
        }
        
        // Show loading indicator for large files
        if (fileSizeMB > 1) {
            showLoadingIndicator('Parsing large JSON file...');
        }
        
        jsonData = JSON.parse(jsonText);
        
        // Extract and display resourceType statistics
        updateResourceTypeTable(jsonData);
        
        // Auto-adjust max depth based on file size
        if (fileSizeMB > 2) {
            maxInitialDepth = 2;
            maxDepthInput.value = 2;
        } else if (fileSizeMB > 1) {
            maxInitialDepth = 2;
            maxDepthInput.value = 2;
        }
        
        // Build graph asynchronously for large files
        if (fileSizeMB > 1) {
            setTimeout(() => {
                buildGraph(jsonData, true); // true indicates fresh build
                hideLoadingIndicator();
                renderGraph();
            }, 10);
        } else {
            buildGraph(jsonData, true); // true indicates fresh build
            renderGraph();
        }
    } catch (e) {
        hideLoadingIndicator();
        alert('Error parsing JSON: ' + e.message);
    }
}

function showLoadingIndicator(message) {
    let loader = document.getElementById('loadingIndicator');
    if (!loader) {
        loader = document.createElement('div');
        loader.id = 'loadingIndicator';
        loader.className = 'loading';
        vizContainer.appendChild(loader);
    }
    loader.textContent = message || 'Loading...';
    loader.style.display = 'block';
}

function hideLoadingIndicator() {
    const loader = document.getElementById('loadingIndicator');
    if (loader) {
        loader.style.display = 'none';
    }
}

// Find the main array with the most sub-objects (typically the FHIR bundle entry array)
function findMainArray(data, path = []) {
    let mainArray = null;
    let maxObjects = 0;
    let mainArrayPath = [];
    
    function traverse(obj, currentPath = []) {
        if (obj === null || obj === undefined) return;
        
        if (Array.isArray(obj)) {
            let objectCount = 0;
            let resourceTypeCount = 0;
            
            obj.forEach(item => {
                if (typeof item === 'object' && item !== null) {
                    objectCount++;
                    if (item.resourceType) {
                        resourceTypeCount++;
                    }
                }
            });
            
            const score = resourceTypeCount > 0 ? resourceTypeCount * 1000 + objectCount : objectCount;
            
            if (score > maxObjects) {
                maxObjects = score;
                mainArray = obj;
                mainArrayPath = [...currentPath];
            }
        } else if (typeof obj === 'object') {
            Object.entries(obj).forEach(([key, value]) => {
                traverse(value, [...currentPath, key]);
            });
        }
    }
    
    traverse(data, path);
    return { array: mainArray, path: mainArrayPath };
}

// Global counters for node and edge IDs (persistent across expansions)
let nodeIdCounter = 0;
let edgeIdCounter = 0;

// Helper function to create a node (used by both buildGraph and expandNode)
function createNodeForGraph(label, value, type, parentId, depth, rawData, childrenCount, isCollapsed, jsonPath, resourceType, isExpanded) {
    const id = nodeIdCounter++;
    
    // Determine node color and styling (Neo4j-style)
    let color = '#ffffff';
    let borderColor = '#333333';
    
    if (type === 'color' && value) {
        color = value;
        borderColor = '#333333';
    } else if (resourceType) {
        color = getResourceTypeColor(resourceType);
        const rgb = hexToRgb(color);
        if (rgb) {
            borderColor = `rgb(${Math.max(0, rgb.r - 40)}, ${Math.max(0, rgb.g - 40)}, ${Math.max(0, rgb.b - 40)})`;
        }
    } else {
        switch(type) {
            case 'array':
                color = '#e3f2fd';
                borderColor = '#2196f3';
                break;
            case 'object':
                color = '#f3e5f5';
                borderColor = '#9c27b0';
                break;
            case 'string':
                color = '#e8f5e9';
                borderColor = '#4caf50';
                break;
            case 'number':
                color = '#fff3e0';
                borderColor = '#ff9800';
                break;
            case 'boolean':
                color = '#fce4ec';
                borderColor = '#e91e63';
                break;
            default:
                color = '#ffffff';
                borderColor = '#333333';
        }
    }
    
    const textColor = getContrastColor(color);
    
    let displayLabel = label;
    const hasChildren = (type === 'array' || type === 'object') && rawData !== null && 
                      ((Array.isArray(rawData) && rawData.length > 0) || 
                       (typeof rawData === 'object' && Object.keys(rawData).length > 0));
    
    const actuallyCollapsed = hasChildren && !isExpanded && !expandedNodes.has(id);
    
    if (actuallyCollapsed && childrenCount > 0) {
        displayLabel = label + ' ▶';
    }
    
    const newNode = {
        id: id,
        label: displayLabel,
        title: label + (hasChildren ? ` (${childrenCount} ${childrenCount === 1 ? 'child' : 'children'})` : ''),
        type: type,
        parentId: parentId,
        depth: depth,
        rawData: rawData,
        childrenCount: childrenCount,
        isCollapsed: actuallyCollapsed,
        children: [],
        jsonPath: jsonPath || [],
        resourceType: resourceType,
        isExpanded: isExpanded || expandedNodes.has(id),
        color: {
            background: color,
            border: borderColor,
            highlight: {
                background: color,
                border: '#007bff'
            },
            hover: {
                background: color,
                border: '#0056b3'
            }
        },
        font: {
            color: textColor,
            size: 14,
            face: 'Arial'
        },
        shape: 'box',
        borderWidth: 2,
        shadow: true
    };
    
    if (jsonPath) {
        nodeJsonPath.set(id, jsonPath);
    }
    
    if (parentId !== null) {
        const edge = {
            id: edgeIdCounter++,
            from: parentId,
            to: id,
            label: '',
            arrows: 'to',
            color: {
                color: '#999999',
                highlight: '#007bff',
                hover: '#0056b3'
            },
            width: 2,
            smooth: {
                type: 'curvedCW',
                roundness: 0.2
            }
        };
        allEdges.push(edge);
        const parentNode = allNodes.find(n => n.id === parentId);
        if (parentNode) {
            parentNode.children.push(id);
        }
    }
    
    const existingNodeIndex = allNodes.findIndex(n => n.id === id);
    if (existingNodeIndex === -1) {
        allNodes.push(newNode);
    } else {
        allNodes[existingNodeIndex] = newNode;
    }
    
    return id;
}

function buildGraph(data, isFreshBuild = false) {
    // If this is a fresh build, reset everything
    if (isFreshBuild) {
        allNodes = [];
        allEdges = [];
        nodeJsonPath.clear();
        nodeIdCounter = 0;
        edgeIdCounter = 0;
        expandedNodes.clear();
        focusedNodeId = null;
        navigationStack = [];
    }
    
    // Preserve navigation state (only if not a fresh build)
    const savedFocusedPath = !isFreshBuild && focusedNodeId !== null 
        ? allNodes.find(n => n.id === focusedNodeId)?.jsonPath 
        : null;
    const savedStackPaths = !isFreshBuild && navigationStack.length > 0
        ? navigationStack.map(id => 
            allNodes.find(n => n.id === id)?.jsonPath
          ).filter(p => p !== undefined)
        : [];
    
    // Find the main array with the most sub-objects
    const mainArrayInfo = findMainArray(data);
    let rootData = data;
    let rootKey = 'root';
    
    if (mainArrayInfo.array && mainArrayInfo.array.length > 0) {
        rootData = mainArrayInfo.array;
        rootKey = mainArrayInfo.path.length > 0 
            ? mainArrayInfo.path[mainArrayInfo.path.length - 1] 
            : 'main';
    }
    
    // Only create root node if this is a fresh build
    if (isFreshBuild && allNodes.length === 0) {
        // Will be created below
    }
    
    // Use the global createNodeForGraph function
    const createNode = createNodeForGraph;
    
    function processValue(value, parentId, key = 'root', depth = 0, parentPath = [], parentResourceType = null, shouldExpandChildren = false) {
        // Build current path: if parentId is null, use parentPath as is (for root), otherwise append key
        const currentPath = parentId === null ? parentPath : [...parentPath, key];
        
        // Check if this object has a resourceType
        let currentResourceType = parentResourceType;
        if (value !== null && typeof value === 'object' && !Array.isArray(value) && value.resourceType) {
            currentResourceType = value.resourceType;
        }
        
        if (value === null) {
            return createNode(key, 'null', 'null', parentId, depth, null, 0, false, currentPath, currentResourceType, false);
        }
        
        const valueType = typeof value;
        
        if (valueType === 'object' && Array.isArray(value)) {
            const arrayNodeId = createNode(
                `${key}: [${value.length} items]`, 
                '', 
                'array', 
                parentId, 
                depth, 
                value, 
                value.length,
                true, // Always start collapsed (lazy loading)
                currentPath,
                currentResourceType,
                shouldExpandChildren // Only expand if explicitly requested
            );
            
            // Only expand if this node has been marked as expanded
            if (shouldExpandChildren || expandedNodes.has(arrayNodeId)) {
                value.forEach((item, index) => {
                    processValue(item, arrayNodeId, String(index), depth + 1, currentPath, currentResourceType, false);
                });
                // Mark as expanded
                expandedNodes.add(arrayNodeId);
            }
            return arrayNodeId;
        } else if (valueType === 'object') {
            const keys = Object.keys(value);
            let labelText;
            if (value.resourceType) {
                labelText = `${value.resourceType}`;
            } else {
                labelText = keys.length > 0 ? `${key}: {${keys.length} keys}` : `${key}: {}`;
            }
            
            const objNodeId = createNode(
                labelText,
                '',
                'object',
                parentId,
                depth,
                value,
                keys.length,
                true, // Always start collapsed (lazy loading)
                currentPath,
                currentResourceType,
                shouldExpandChildren // Only expand if explicitly requested
            );
            
            // Only expand if this node has been marked as expanded
            if (shouldExpandChildren || expandedNodes.has(objNodeId)) {
                Object.entries(value).forEach(([k, v]) => {
                    processValue(v, objNodeId, k, depth + 1, currentPath, currentResourceType, false);
                });
                // Mark as expanded
                expandedNodes.add(objNodeId);
            }
            return objNodeId;
        } else {
            let displayValue = value;
            if (valueType === 'string' && value.length > 30) {
                displayValue = value.substring(0, 30) + '...';
            }
            
            let labelText = `${key}`;
            if (valueType === 'string' && /^#[0-9A-Fa-f]{6}$/.test(value)) {
                labelText = `${key}: ${value}`;
                return createNode(labelText, value, 'color', parentId, depth, null, 0, false, currentPath, currentResourceType, false);
            } else {
                labelText = `${key}: ${displayValue}`;
            }
            
            return createNode(labelText, value, valueType, parentId, depth, null, 0, false, currentPath, currentResourceType, false);
        }
    }
    
    // Process the root data - only create root node initially (lazy loading)
    // Only do this if it's a fresh build (we already cleared allNodes above)
    if (isFreshBuild) {
        // First time building - only create root node
        // Store the path based on whether we're using main array or full data
        const rootPath = mainArrayInfo.path.length > 0 ? [...mainArrayInfo.path] : [];
        if (typeof rootData === 'object' && rootData !== null) {
            // For root, use the actual path from JSON structure
            processValue(rootData, null, rootKey, 0, rootPath, null, false); // Don't expand children
        } else {
            createNode(rootKey, String(rootData), typeof rootData, null, 0, null, 0, false, rootPath, null, false);
        }
    }
    
    // Restore navigation state (only if not a fresh build)
    if (!isFreshBuild && savedFocusedPath) {
        const restoredFocusedNode = allNodes.find(n => 
            n.jsonPath && 
            n.jsonPath.length === savedFocusedPath.length &&
            n.jsonPath.every((val, idx) => val === savedFocusedPath[idx])
        );
        if (restoredFocusedNode) {
            focusedNodeId = restoredFocusedNode.id;
        } else {
            focusedNodeId = null;
            navigationStack = [];
        }
    }
    
    // Restore navigation stack (only if not a fresh build)
    if (!isFreshBuild && savedStackPaths.length > 0) {
        navigationStack = savedStackPaths.map(path => {
            const node = allNodes.find(n => 
                n.jsonPath && 
                n.jsonPath.length === path.length &&
                n.jsonPath.every((val, idx) => val === path[idx])
            );
            return node?.id;
        }).filter(id => id !== undefined);
    }
    
    updateBackButtonVisibility();
}

function initializeVisualization() {
    // Create vis.js DataSets
    nodesDataSet = new vis.DataSet([]);
    edgesDataSet = new vis.DataSet([]);
    
    data = {
        nodes: nodesDataSet,
        edges: edgesDataSet
    };
    
    // Configure Neo4j-style options
    const options = {
        nodes: {
            shape: 'box',
            font: {
                size: 14,
                face: 'Arial'
            },
            borderWidth: 2,
            shadow: true,
            margin: 10,
            widthConstraint: {
                minimum: 100,
                maximum: 200
            },
            heightConstraint: {
                minimum: 30
            }
        },
        edges: {
            arrows: {
                to: {
                    enabled: true,
                    scaleFactor: 0.5
                }
            },
            color: {
                color: '#999999',
                highlight: '#007bff',
                hover: '#0056b3'
            },
            width: 2,
            smooth: {
                type: 'curvedCW',
                roundness: 0.2
            }
        },
        physics: {
            enabled: true,
            stabilization: {
                enabled: true,
                iterations: 200,
                fit: true
            },
            barnesHut: {
                gravitationalConstant: -2000,
                centralGravity: 0.3,
                springLength: 200,
                springConstant: 0.04,
                damping: 0.09,
                avoidOverlap: 1
            }
        },
        interaction: {
            dragNodes: true,
            dragView: true,
            zoomView: true,
            selectConnectedEdges: true,
            tooltipDelay: 100,
            hover: true
        },
        layout: {
            improvedLayout: true,
            hierarchical: {
                enabled: false
            }
        }
    };
    
    // Create network
    const networkContainer = document.getElementById('neo4jNetwork');
    network = new vis.Network(networkContainer, data, options);
    
    // Handle single click - highlight JSON
    let clickTimeout = null;
    network.on('click', (params) => {
        if (params.nodes.length > 0) {
            const nodeId = params.nodes[0];
            const node = allNodes.find(n => n.id === nodeId);
            if (node) {
                // Single click - highlight JSON
                clearTimeout(clickTimeout);
                clickTimeout = setTimeout(() => {
                    highlightJsonForNode(node);
                }, 300); // Wait to see if it's a double click
            }
        } else {
            // Clicked on empty space - clear selection
            network.unselectAll();
            clearTimeout(clickTimeout);
        }
    });
    
    // Handle double click - expand node
    network.on('doubleClick', (params) => {
        clearTimeout(clickTimeout); // Cancel single click handler
        if (params.nodes.length > 0) {
            const nodeId = params.nodes[0];
            const node = allNodes.find(n => n.id === nodeId);
            if (node) {
                expandNode(node);
            }
        }
    });
    
    // Handle window resize
    window.addEventListener('resize', () => {
        if (network) {
            network.redraw();
            setTimeout(() => {
                fitToView();
            }, 100);
        }
    });
}

// Expand all paths to nodes with a specific resourceType
function expandPathsToResourceType(resourceType) {
    if (!jsonData || !resourceType) {
        console.warn('expandPathsToResourceType called with invalid data:', { jsonData: !!jsonData, resourceType });
        return;
    }
    
    // Find all paths to nodes with this resourceType in the JSON data
    const pathsToExpand = [];
    
    function findResourceTypePaths(data, path = [], parentResourceType = null) {
        if (data === null || data === undefined) return;
        
        // Check if this object has the target resourceType
        if (typeof data === 'object' && !Array.isArray(data) && data.resourceType === resourceType) {
            pathsToExpand.push([...path]);
        }
        
        // Determine current resourceType for propagation
        let currentResourceType = parentResourceType;
        if (typeof data === 'object' && !Array.isArray(data) && data.resourceType) {
            currentResourceType = data.resourceType;
        }
        
        if (Array.isArray(data)) {
            data.forEach((item, index) => {
                findResourceTypePaths(item, [...path, String(index)], currentResourceType);
            });
        } else if (typeof data === 'object') {
            Object.entries(data).forEach(([key, value]) => {
                findResourceTypePaths(value, [...path, key], currentResourceType);
            });
        }
    }
    
    findResourceTypePaths(jsonData);
    
    console.log(`Found ${pathsToExpand.length} paths to resourceType "${resourceType}"`);
    if (pathsToExpand.length > 0) {
        console.log('Sample paths:', pathsToExpand.slice(0, 3));
    }
    
    // Check root node path
    const rootNode = allNodes.find(n => n.parentId === null);
    if (rootNode) {
        console.log(`Root node path: [${rootNode.jsonPath.join(', ')}]`);
    }
    
    // Expand each path - expand them all before checking
    pathsToExpand.forEach((path, index) => {
        expandPathInGraph(path);
    });
    
    // After expanding all paths, verify nodes were created
    const createdNodes = allNodes.filter(n => n.resourceType === resourceType);
    console.log(`After expansion, found ${createdNodes.length} nodes with resourceType "${resourceType}"`);
    if (createdNodes.length === 0 && pathsToExpand.length > 0) {
        console.warn('No nodes created despite paths found. Checking all nodes:');
        console.log('All nodes count:', allNodes.length);
        console.log('Sample nodes:', allNodes.slice(0, 5).map(n => ({
            id: n.id,
            label: n.label,
            resourceType: n.resourceType,
            jsonPath: n.jsonPath
        })));
    }
}

// Expand a path in the graph (create nodes if needed)
function expandPathInGraph(path) {
    if (!path || path.length === 0) {
        return;
    }
    
    // Get the root node
    const rootNode = allNodes.find(n => n.parentId === null);
    if (!rootNode) {
        console.warn('No root node found for path expansion');
        return;
    }
    
    // Check if the path starts with the root node's path
    const rootPath = rootNode.jsonPath || [];
    
    // Verify path starts with root path
    if (rootPath.length > 0) {
        const pathMatchesRoot = path.length >= rootPath.length &&
            rootPath.every((val, idx) => val === path[idx]);
        if (!pathMatchesRoot) {
            console.warn(`Path [${path.join(', ')}] does not start with root path [${rootPath.join(', ')}]`);
            return;
        }
    }
    
    let currentNode = rootNode;
    let currentData = jsonData;
    
    // Navigate to the root node's data in JSON
    for (const key of rootPath) {
        if (Array.isArray(currentData)) {
            const index = parseInt(key);
            if (!isNaN(index) && index < currentData.length) {
                currentData = currentData[index];
            }
        } else if (typeof currentData === 'object' && currentData !== null) {
            if (key in currentData) {
                currentData = currentData[key];
            }
        }
    }
    
    // Start from after the root path
    const startIndex = rootPath.length;
    
    // Now navigate the remaining path (children of root)
    for (let i = startIndex; i < path.length; i++) {
        const key = path[i];
        
        // Navigate JSON data
        if (Array.isArray(currentData)) {
            const index = parseInt(key);
            if (isNaN(index) || index >= currentData.length) {
                console.warn(`Invalid array index in path expansion: ${key} at index ${i}`);
                return;
            }
            currentData = currentData[index];
        } else if (typeof currentData === 'object' && currentData !== null) {
            if (!(key in currentData)) {
                console.warn(`Key not found in path expansion: ${key} at index ${i}`);
                return;
            }
            currentData = currentData[key];
        } else {
            console.warn(`Cannot navigate path, reached non-object at: ${key}`);
            return;
        }
        
        // Build the full path so far (from JSON root)
        const pathSoFar = path.slice(0, i + 1);
        
        // Try to find node with matching path
        let node = allNodes.find(n => {
            if (!n.jsonPath) return false;
            if (n.jsonPath.length !== pathSoFar.length) return false;
            return n.jsonPath.every((val, idx) => val === pathSoFar[idx]);
        });
        
        // If node doesn't exist, expand the parent to create it
        if (!node && currentNode && currentNode.rawData) {
            // Expand current node to create children
            if (!currentNode.isExpanded) {
                expandNode(currentNode);
                // Force a small delay to ensure nodes are added
                // Actually, expandNode should be synchronous, so nodes should be available immediately
            }
            
            // Search again for the node after expansion
            node = allNodes.find(n => {
                if (!n.jsonPath) return false;
                if (n.jsonPath.length !== pathSoFar.length) return false;
                return n.jsonPath.every((val, idx) => val === pathSoFar[idx]);
            });
        }
        
        if (node) {
            currentNode = node;
        } else {
            // If we still can't find it, log and continue - might be able to create it later
            console.warn(`Could not find or create node at path: [${pathSoFar.join(', ')}]`);
            console.warn(`Current node: ${currentNode.label}, path: [${(currentNode.jsonPath || []).join(', ')}]`);
        }
    }
}

// Track if we've already expanded paths for the current resourceType filter
let lastExpandedResourceType = null;

function renderGraph() {
    if (allNodes.length === 0) return;
    
    // If filtering by resourceType, expand all paths to matching nodes first
    // Only expand if the resourceType filter changed
    if (selectedResourceType !== null && lastExpandedResourceType !== selectedResourceType) {
        console.log(`Expanding paths for resourceType: ${selectedResourceType}`);
        expandPathsToResourceType(selectedResourceType);
        lastExpandedResourceType = selectedResourceType;
        // After expanding, wait a moment for all nodes to be created, then render again
        setTimeout(() => {
            console.log('Re-rendering after path expansion...');
            renderGraph();
        }, 100);
        return;
    } else if (selectedResourceType === null) {
        lastExpandedResourceType = null;
    }
    
    // Filter nodes based on current state
    let visibleNodes = allNodes;
    let visibleEdges = allEdges;
    
    // Apply resourceType filter - only show matching nodes and their direct ancestor paths (no siblings)
    if (selectedResourceType !== null) {
        const visibleNodeIds = new Set();
        
        // First, ensure we have all matching nodes
        const matchingNodes = allNodes.filter(n => n.resourceType === selectedResourceType);
        console.log(`Filtering: Found ${matchingNodes.length} nodes with resourceType "${selectedResourceType}"`);
        
        // If no matching nodes found, they might not be expanded yet
        // This should have been handled by expandPathsToResourceType above, but double-check
        if (matchingNodes.length === 0) {
            console.warn(`No matching nodes found for resourceType "${selectedResourceType}"`);
            console.warn(`Total nodes in graph: ${allNodes.length}`);
            console.warn('Sample node resourceTypes:', allNodes.slice(0, 10).map(n => n.resourceType).filter(rt => rt));
            
            // Try expanding paths again with more aggressive expansion
            console.warn('Attempting to expand paths again...');
            expandPathsToResourceType(selectedResourceType);
            
            // Wait a bit and re-render - but limit retries to avoid infinite loops
            if (!renderGraph.retryCount) {
                renderGraph.retryCount = 0;
            }
            if (renderGraph.retryCount < 3) {
                renderGraph.retryCount++;
                setTimeout(() => {
                    renderGraph();
                }, 300);
            } else {
                console.error('Failed to create nodes after multiple retries. Showing all nodes for debugging.');
                // As a fallback, show all nodes so user can see what's in the graph
                visibleNodes = allNodes;
                visibleEdges = allEdges;
                renderGraph.retryCount = 0;
            }
            return;
        }
        renderGraph.retryCount = 0; // Reset retry count on success
        
        // For each matching node, trace back to root and add only that specific path
        matchingNodes.forEach(matchingNode => {
            // Add the matching node itself
            visibleNodeIds.add(matchingNode.id);
            
            // Trace back to root, adding only nodes on this specific path
            let currentNode = matchingNode;
            while (currentNode.parentId !== null) {
                const parentNode = allNodes.find(n => n.id === currentNode.parentId);
                if (parentNode) {
                    visibleNodeIds.add(parentNode.id);
                    currentNode = parentNode;
                } else {
                    break;
                }
            }
        });
        
        // Filter nodes - only include those in visibleNodeIds (matching nodes and their ancestors)
        visibleNodes = allNodes.filter(n => visibleNodeIds.has(n.id));
        
        // Filter edges - only show edges between visible nodes
        // Since we only include nodes on paths to matching nodes, edges between them are valid
        visibleEdges = allEdges.filter(e => {
            const fromId = typeof e.from === 'object' ? e.from.id : e.from;
            const toId = typeof e.to === 'object' ? e.to.id : e.to;
            return visibleNodeIds.has(fromId) && visibleNodeIds.has(toId);
        });
        
        // If we still have no visible nodes after filtering, something went wrong
        if (visibleNodes.length === 0 && matchingNodes.length > 0) {
            console.warn('Filtering resulted in no visible nodes despite matching nodes existing');
        }
    }
    
    // Apply focused node filter (drill-down)
    if (focusedNodeId !== null && selectedResourceType === null) {
        const focusedNode = allNodes.find(n => n.id === focusedNodeId);
            if (focusedNode) {
                const descendantIds = new Set([focusedNodeId]);
                function addDescendants(nodeId) {
                const node = allNodes.find(n => n.id === nodeId);
                    if (node && node.children) {
                        node.children.forEach(childId => {
                            descendantIds.add(childId);
                            addDescendants(childId);
                        });
                    }
                }
                addDescendants(focusedNodeId);
            
            visibleNodes = visibleNodes.filter(n => descendantIds.has(n.id));
            visibleEdges = visibleEdges.filter(e => 
                descendantIds.has(e.from) && descendantIds.has(e.to)
            );
        }
    }
    
    // Handle cleared view
    if (isCleared && selectedResourceType === null && focusedNodeId === null) {
        visibleNodes = [];
        visibleEdges = [];
    }
    
    // Highlight focused node
    visibleNodes.forEach(node => {
        if (node.id === focusedNodeId) {
            node.borderWidth = 4;
            node.color.border = '#007bff';
            } else {
            node.borderWidth = 2;
        }
        
        // Highlight search matches
        if (searchHighlightedNodes.has(node.id)) {
            node.color.background = '#fff3cd';
            node.color.border = '#ffc107';
        }
    });
    
    // Update DataSets
    nodesDataSet.clear();
    edgesDataSet.clear();
    
    console.log(`Rendering: ${visibleNodes.length} visible nodes, ${visibleEdges.length} visible edges`);
    
    if (visibleNodes.length > 0) {
        nodesDataSet.add(visibleNodes);
        edgesDataSet.add(visibleEdges);
        
        // Explicitly trigger network update
        if (network) {
            network.redraw();
        }
        
        // Fit to view after rendering
        setTimeout(() => {
            fitToView();
        }, 300);
    } else {
        console.warn('No visible nodes to render');
        // Still update the network to clear it
        if (network) {
            network.redraw();
        }
    }
}

// Helper function to create a node (used by both buildGraph and expandNode)
function createNodeForGraph(label, value, type, parentId, depth, rawData, childrenCount, isCollapsed, jsonPath, resourceType, isExpanded) {
    const id = nodeIdCounter++;
    
    // Determine node color and styling (Neo4j-style)
    let color = '#ffffff';
    let borderColor = '#333333';
    
    if (type === 'color' && value) {
        color = value;
        borderColor = '#333333';
    } else if (resourceType) {
        color = getResourceTypeColor(resourceType);
        const rgb = hexToRgb(color);
        if (rgb) {
            borderColor = `rgb(${Math.max(0, rgb.r - 40)}, ${Math.max(0, rgb.g - 40)}, ${Math.max(0, rgb.b - 40)})`;
        }
    } else {
        switch(type) {
            case 'array':
                color = '#e3f2fd';
                borderColor = '#2196f3';
                break;
            case 'object':
                color = '#f3e5f5';
                borderColor = '#9c27b0';
                break;
            case 'string':
                color = '#e8f5e9';
                borderColor = '#4caf50';
                break;
            case 'number':
                color = '#fff3e0';
                borderColor = '#ff9800';
                break;
            case 'boolean':
                color = '#fce4ec';
                borderColor = '#e91e63';
                break;
            default:
                color = '#ffffff';
                borderColor = '#333333';
        }
    }
    
    const textColor = getContrastColor(color);
    
    let displayLabel = label;
    const hasChildren = (type === 'array' || type === 'object') && rawData !== null && 
                      ((Array.isArray(rawData) && rawData.length > 0) || 
                       (typeof rawData === 'object' && Object.keys(rawData).length > 0));
    
    const actuallyCollapsed = hasChildren && !isExpanded && !expandedNodes.has(id);
    
    if (actuallyCollapsed && childrenCount > 0) {
        displayLabel = label + ' ▶';
    }
    
    const newNode = {
        id: id,
        label: displayLabel,
        title: label + (hasChildren ? ` (${childrenCount} ${childrenCount === 1 ? 'child' : 'children'})` : ''),
        type: type,
        parentId: parentId,
        depth: depth,
        rawData: rawData,
        childrenCount: childrenCount,
        isCollapsed: actuallyCollapsed,
        children: [],
        jsonPath: jsonPath || [],
        resourceType: resourceType,
        isExpanded: isExpanded || expandedNodes.has(id),
        color: {
            background: color,
            border: borderColor,
            highlight: {
                background: color,
                border: '#007bff'
            },
            hover: {
                background: color,
                border: '#0056b3'
            }
        },
        font: {
            color: textColor,
            size: 14,
            face: 'Arial'
        },
        shape: 'box',
        borderWidth: 2,
        shadow: true
    };
    
    if (jsonPath) {
        nodeJsonPath.set(id, jsonPath);
    }
    
    if (parentId !== null) {
        const edge = {
            id: edgeIdCounter++,
            from: parentId,
            to: id,
            label: '',
            arrows: 'to',
            color: {
                color: '#999999',
                highlight: '#007bff',
                hover: '#0056b3'
            },
            width: 2,
            smooth: {
                type: 'curvedCW',
                roundness: 0.2
            }
        };
        allEdges.push(edge);
        const parentNode = allNodes.find(n => n.id === parentId);
        if (parentNode) {
            parentNode.children.push(id);
        }
    }
    
    const existingNodeIndex = allNodes.findIndex(n => n.id === id);
    if (existingNodeIndex === -1) {
        allNodes.push(newNode);
    } else {
        allNodes[existingNodeIndex] = newNode;
    }
    
    return id;
}

// Expand a node by loading its children (lazy loading)
function expandNode(node) {
    // Check if node can be expanded (has children and rawData)
    if (!node.rawData || node.isExpanded) {
        if (node.isCollapsed && node.childrenCount === 0) {
            highlightJsonForNode(node);
        }
        return;
    }
    
    // Check if node has children to expand
    const hasChildren = (node.type === 'array' || node.type === 'object') && 
                       ((Array.isArray(node.rawData) && node.rawData.length > 0) || 
                        (typeof node.rawData === 'object' && Object.keys(node.rawData).length > 0));
    
    if (!hasChildren) {
        highlightJsonForNode(node);
        return;
    }
    
    // Mark node as expanded
    expandedNodes.add(node.id);
    node.isExpanded = true;
    node.isCollapsed = false;
    
    // Function to create child nodes during expansion
    function expandNodeChildren(value, key, parentId, parentPath = [], parentResourceType = null) {
        const valueType = typeof value;
        const depth = node.depth + 1;
        // Build path: parentPath should already contain the full path to parent
        const currentPath = parentPath.length > 0 ? [...parentPath, key] : [key];
        
        if (value === null) {
            return createNodeForGraph(`${key}: null`, 'null', 'null', parentId, depth, null, 0, false, currentPath, parentResourceType, false);
        }
        
        if (valueType === 'object' && Array.isArray(value)) {
            let currentResourceType = parentResourceType;
            if (value.length > 0 && typeof value[0] === 'object' && value[0].resourceType) {
                currentResourceType = value[0].resourceType;
            }
            
            return createNodeForGraph(
                `${key}: [${value.length} items]`, 
                '', 
                'array', 
                parentId, 
                depth, 
                value, 
                value.length,
                true,
                currentPath,
                currentResourceType,
                false
            );
        } else if (valueType === 'object') {
            const keys = Object.keys(value);
            let currentResourceType = parentResourceType;
            if (value.resourceType) {
                currentResourceType = value.resourceType;
            }
            
            let labelText;
            if (value.resourceType) {
                labelText = `${value.resourceType}`;
            } else {
                labelText = keys.length > 0 ? `${key}: {${keys.length} keys}` : `${key}: {}`;
            }
            
            return createNodeForGraph(
                labelText,
                '',
                'object',
                parentId,
                depth,
                value,
                keys.length,
                true,
                currentPath,
                currentResourceType,
                false
            );
        } else {
            let displayValue = value;
            if (valueType === 'string' && value.length > 30) {
                displayValue = value.substring(0, 30) + '...';
            }
            
            let labelText = `${key}`;
            if (valueType === 'string' && /^#[0-9A-Fa-f]{6}$/.test(value)) {
                labelText = `${key}: ${value}`;
                return createNodeForGraph(labelText, value, 'color', parentId, depth, null, 0, false, currentPath, parentResourceType, false);
            } else {
                labelText = `${key}: ${displayValue}`;
            }
            
            return createNodeForGraph(labelText, value, valueType, parentId, depth, null, 0, false, currentPath, parentResourceType, false);
        }
    }
    
    // Expand the node based on its type
    if (node.type === 'array' && Array.isArray(node.rawData)) {
        node.rawData.forEach((item, index) => {
            expandNodeChildren(item, String(index), node.id, node.jsonPath, node.resourceType);
        });
    } else if (node.type === 'object' && typeof node.rawData === 'object') {
        Object.entries(node.rawData).forEach(([key, value]) => {
            let currentResourceType = node.resourceType;
            if (value !== null && typeof value === 'object' && !Array.isArray(value) && value.resourceType) {
                currentResourceType = value.resourceType;
            }
            expandNodeChildren(value, key, node.id, node.jsonPath, currentResourceType);
        });
    }
    
    // Update node label to remove collapsed indicator
    node.label = node.label.replace(' ▶', '');
    const nodeIndex = allNodes.findIndex(n => n.id === node.id);
    if (nodeIndex !== -1) {
        allNodes[nodeIndex] = node;
    }
    
    // Re-render the graph
    renderGraph();
}

function focusOnNode(node) {
    // Highlight JSON first
    highlightJsonForNode(node);
    
    // Add current focus to navigation stack
    if (focusedNodeId !== node.id) {
        if (focusedNodeId !== null) {
            navigationStack.push(focusedNodeId);
        }
        focusedNodeId = node.id;
    }
    
    updateBackButtonVisibility();
    
    // Expand node if collapsed (drill-down view)
    if (node.isCollapsed && node.rawData && (node.type === 'object' || node.type === 'array')) {
        expandNode(node);
    }
    
    renderGraph();
}

function navigateBack() {
    if (navigationStack.length > 0) {
        focusedNodeId = navigationStack.pop();
        updateBackButtonVisibility();
        
        const node = allNodes.find(n => n.id === focusedNodeId);
        if (node) {
            highlightJsonForNode(node);
        }
    } else {
        focusedNodeId = null;
        updateBackButtonVisibility();
        clearJsonHighlight();
    }
    
    renderGraph();
}

function updateBackButtonVisibility() {
    if (focusedNodeId !== null || navigationStack.length > 0) {
        backBtn.style.display = 'inline-block';
    } else {
        backBtn.style.display = 'none';
    }
}

// Highlight JSON text for a node
function highlightJsonForNode(node) {
    if (!node.jsonPath || node.jsonPath.length === 0) {
        highlightJsonRange(0, jsonEditor.value.length);
        return;
    }
    
    const location = findJsonPathLocation(jsonData, node.jsonPath, jsonEditor.value);
    if (location) {
        highlightJsonRange(location.start, location.end);
        scrollToJsonPosition(location.start);
    }
}

// Find the character range in JSON text for a given path
function findJsonPathLocation(data, path, jsonText) {
    if (!path || path.length === 0) {
        return { start: 0, end: jsonText.length };
    }
    
    try {
        let searchOffset = 0;
        let current = data;
        
        for (let i = 0; i < path.length; i++) {
            const key = path[i];
            
            if (Array.isArray(current)) {
                const index = parseInt(key);
                if (isNaN(index) || index >= current.length) return null;
                current = current[index];
                
                const result = findNthArrayItem(jsonText, searchOffset, index);
                if (!result) return null;
                searchOffset = result.start;
            } else if (typeof current === 'object' && current !== null) {
                if (!(key in current)) return null;
                current = current[key];
                
                const result = findPropertyLocation(jsonText, key, searchOffset);
                if (!result) return null;
                
                if (i === path.length - 1) {
                    return {
                        start: result.valueStart,
                        end: result.valueEnd
                    };
                }
                
                searchOffset = result.valueStart;
            } else {
                return null;
            }
        }
        
        const valueEnd = findValueEnd(jsonText, searchOffset);
        return {
            start: searchOffset,
            end: valueEnd
        };
    } catch (e) {
        console.error('Error finding JSON path:', e);
        return null;
    }
}

function findNthArrayItem(text, startOffset, targetIndex) {
    let depth = 0;
    let inString = false;
    let escapeNext = false;
    let currentIndex = 0;
    let itemStart = -1;
    
    let bracketPos = -1;
    for (let i = startOffset; i < text.length; i++) {
        if (text[i] === '[') {
            bracketPos = i;
            itemStart = i + 1;
            break;
        }
    }
    
    if (bracketPos === -1) return null;
    
    for (let i = bracketPos + 1; i < text.length; i++) {
        const char = text[i];
        
        if (escapeNext) {
            escapeNext = false;
            continue;
        }
        
        if (char === '\\') {
            escapeNext = true;
            continue;
        }
        
        if (char === '"' && !escapeNext) {
            inString = !inString;
            continue;
        }
        
        if (inString) continue;
        
        if (char === '[' || char === '{') {
            depth++;
        } else if (char === ']' || char === '}') {
            depth--;
            if (char === ']' && depth === 0) {
                if (currentIndex === targetIndex && itemStart !== -1) {
                    return { start: itemStart, end: i };
                }
                break;
            }
        } else if (char === ',' && depth === 0) {
            if (currentIndex === targetIndex && itemStart !== -1) {
                return { start: itemStart, end: i };
            }
            currentIndex++;
            itemStart = i + 1;
        }
    }
    
    if (currentIndex === targetIndex && itemStart !== -1) {
        const closingBracket = text.indexOf(']', bracketPos);
        return { start: itemStart, end: closingBracket > -1 ? closingBracket : text.length };
    }
    
    return null;
}

function findPropertyLocation(text, key, startOffset) {
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`"${escapedKey}"\\s*:`, 'g');
    
    regex.lastIndex = startOffset;
    const match = regex.exec(text);
    
    if (!match) return null;
    
    const keyStart = match.index;
    const colonEnd = match.index + match[0].length;
    
    let valueStart = colonEnd;
    while (valueStart < text.length && /\s/.test(text[valueStart])) {
        valueStart++;
    }
    
    const valueEnd = findValueEnd(text, valueStart);
    
    return {
        start: keyStart,
        valueStart: valueStart,
        valueEnd: valueEnd
    };
}

function findValueEnd(text, start) {
    let inString = false;
    let escapeNext = false;
    let depth = 0;
    let bracketCount = 0;
    
    for (let i = start; i < text.length; i++) {
        const char = text[i];
        
        if (escapeNext) {
            escapeNext = false;
            continue;
        }
        
        if (char === '\\') {
            escapeNext = true;
            continue;
        }
        
        if (char === '"' && !escapeNext) {
            inString = !inString;
            if (!inString && depth === 0 && bracketCount === 0) {
                return i + 1;
            }
            continue;
        }
        
        if (inString) continue;
        
        if (char === '{') {
            depth++;
            bracketCount++;
        } else if (char === '}') {
            depth--;
            bracketCount--;
            if (depth === 0 && bracketCount === 0) {
                return i + 1;
            }
        } else if (char === '[') {
            bracketCount++;
        } else if (char === ']') {
            bracketCount--;
            if (bracketCount === 0 && depth === 0) {
                return i + 1;
            }
        } else if ((char === ',' || char === '}' || char === ']') && depth === 0 && bracketCount === 0) {
            return i;
        }
    }
    
    return text.length;
}

let highlightTimeout = null;
function highlightJsonRange(start, end) {
    clearJsonHighlight();
    
    jsonEditor.focus();
    jsonEditor.setSelectionRange(start, end);
    
    if (highlightTimeout) {
        clearTimeout(highlightTimeout);
    }
    highlightTimeout = setTimeout(() => {
        jsonEditor.setSelectionRange(start, start);
    }, 3000);
}

function clearJsonHighlight() {
    if (highlightTimeout) {
        clearTimeout(highlightTimeout);
        highlightTimeout = null;
    }
}

function scrollToJsonPosition(position) {
    const textBefore = jsonEditor.value.substring(0, position);
    const lines = textBefore.split('\n');
    const lineNumber = lines.length - 1;
    
    const lineHeight = 20;
    const visibleLines = jsonEditor.clientHeight / lineHeight;
    const targetScroll = Math.max(0, (lineNumber - visibleLines / 2) * lineHeight);
    
    jsonEditor.scrollTop = targetScroll;
}

function zoomIn() {
    if (network) {
        const scale = network.getScale();
        network.moveTo({ scale: scale * 1.2 });
    }
}

function zoomOut() {
    if (network) {
        const scale = network.getScale();
        network.moveTo({ scale: scale * 0.8 });
    }
}

function fitToView() {
    if (network && allNodes.length > 0) {
        network.fit({
            animation: {
                duration: 750,
                easingFunction: 'easeInOutQuad'
            }
        });
    }
}

function handleSearch() {
    const searchTerm = searchInput.value.toLowerCase().trim();
    searchHighlightedNodes.clear();
    
    if (!searchTerm) {
        renderGraph();
        return;
    }
    
    // Search through all nodes (including those not yet loaded)
    // For nodes not yet in the graph, we need to search through the raw JSON data
    function searchInData(data, path = [], parentNodeId = null) {
        if (data === null || data === undefined) return;
        
        const dataType = typeof data;
        
        if (dataType === 'object' && Array.isArray(data)) {
            data.forEach((item, index) => {
                const currentPath = [...path, String(index)];
                // Check if this item matches
                if (JSON.stringify(item).toLowerCase().includes(searchTerm)) {
                    // Need to expand path to this node
                    expandPathToCreateNode(currentPath, parentNodeId);
                }
                searchInData(item, currentPath, parentNodeId);
            });
        } else if (dataType === 'object') {
            Object.entries(data).forEach(([key, value]) => {
                const currentPath = [...path, key];
                // Check if key or value matches
                if (key.toLowerCase().includes(searchTerm) || 
                    (typeof value === 'string' && value.toLowerCase().includes(searchTerm))) {
                    expandPathToCreateNode(currentPath, parentNodeId);
                }
                searchInData(value, currentPath, parentNodeId);
            });
        } else if (String(data).toLowerCase().includes(searchTerm)) {
            expandPathToCreateNode(path, parentNodeId);
        }
    }
    
    // Helper to expand path and create nodes if needed
    function expandPathToCreateNode(path, parentNodeId) {
        // Expand all nodes in the path to make the target node visible
        let currentData = jsonData;
        let currentNodeId = null;
        
        for (let i = 0; i < path.length; i++) {
            const key = path[i];
            
            // Navigate through the data
            if (Array.isArray(currentData)) {
                const index = parseInt(key);
                if (isNaN(index) || index >= currentData.length) return;
                currentData = currentData[index];
            } else if (typeof currentData === 'object' && currentData !== null) {
                if (!(key in currentData)) return;
                currentData = currentData[key];
            } else {
                return;
            }
            
            // Find or create node at this path level
            const pathSoFar = path.slice(0, i + 1);
            let node = allNodes.find(n => 
                n.jsonPath && 
                n.jsonPath.length === pathSoFar.length &&
                n.jsonPath.every((val, idx) => val === pathSoFar[idx])
            );
            
            if (!node && currentNodeId !== null) {
                // Need to expand parent node to create this node
                const parentNode = allNodes.find(n => n.id === currentNodeId);
                if (parentNode && !parentNode.isExpanded) {
                    expandNode(parentNode);
                    // Find the newly created node
                    node = allNodes.find(n => 
                        n.jsonPath && 
                        n.jsonPath.length === pathSoFar.length &&
                        n.jsonPath.every((val, idx) => val === pathSoFar[idx])
                    );
                }
            }
            
            if (node) {
                currentNodeId = node.id;
                if (i === path.length - 1) {
                    // This is the target node - highlight it
                    searchHighlightedNodes.add(node.id);
                }
            }
        }
    }
    
    // First, highlight existing nodes that match
    allNodes.forEach(node => {
        if (node.label.toLowerCase().includes(searchTerm)) {
            searchHighlightedNodes.add(node.id);
            expandPathToNode(node.id);
        }
    });
    
    // Also search in JSON data for nodes that haven't been loaded yet
    searchInData(jsonData);
    
    renderGraph();
}

function expandPathToNode(nodeId) {
    // Expand all parent nodes up to the root to reveal the target node
    const pathToNode = [];
    let currentId = nodeId;
    
    // Build path from node to root
    while (currentId !== null) {
        const node = allNodes.find(n => n.id === currentId);
        if (node) {
            pathToNode.unshift(node);
            currentId = node.parentId;
        } else {
            break;
        }
    }
    
    // Expand each node in the path
    pathToNode.forEach(node => {
        if (node.rawData && !node.isExpanded && (node.type === 'array' || node.type === 'object')) {
            expandNode(node);
        }
    });
}

// Helper functions
function hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
    } : null;
}

function getContrastColor(hexColor) {
    const rgb = hexToRgb(hexColor);
    if (!rgb) return '#333333';
    
    // Calculate luminance
    const luminance = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
    return luminance > 0.5 ? '#000000' : '#ffffff';
}

// Auto-validate JSON on paste
jsonEditor.addEventListener('paste', () => {
    setTimeout(validateJSON, 10);
});

// Generate a color for a resourceType
function getResourceTypeColor(resourceType) {
    if (!resourceType) return '#ffffff';
    
    if (!resourceTypeColors.has(resourceType)) {
        const colors = [
            '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7',
            '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E2',
            '#F8B739', '#6C5CE7', '#A29BFE', '#FD79A8', '#00B894',
            '#E17055', '#81ECEC', '#74B9FF', '#A29BFE', '#FDCB6E',
            '#E84393', '#00CEC9', '#6C5CE7', '#FF7675', '#00B894'
        ];
        
        let hash = 0;
        for (let i = 0; i < resourceType.length; i++) {
            hash = resourceType.charCodeAt(i) + ((hash << 5) - hash);
        }
        const colorIndex = Math.abs(hash) % colors.length;
        resourceTypeColors.set(resourceType, colors[colorIndex]);
    }
    
    return resourceTypeColors.get(resourceType);
}

// Extract resourceType values from FHIR data
function extractResourceTypes(data) {
    const resourceTypeCounts = new Map();
    
    function traverse(obj) {
        if (obj === null || obj === undefined) {
            return;
        }
        
        if (typeof obj === 'object' && !Array.isArray(obj) && obj.resourceType) {
            const resourceType = obj.resourceType;
            resourceTypeCounts.set(resourceType, (resourceTypeCounts.get(resourceType) || 0) + 1);
        }
        
        if (Array.isArray(obj)) {
            obj.forEach(item => traverse(item));
        } else if (typeof obj === 'object') {
            Object.values(obj).forEach(value => traverse(value));
        }
    }
    
    traverse(data);
    return resourceTypeCounts;
}

// Clear the view
function clearView() {
    isCleared = true;
    selectedResourceType = null;
    
    // Update dropdown button
    const dropdownButton = document.getElementById('resourceTypeDropdownButton');
    if (dropdownButton) {
        dropdownButton.textContent = 'Filter by Resource Type';
    }
    
    // Update dropdown items
    const dropdownMenu = document.getElementById('resourceTypeDropdownMenu');
    if (dropdownMenu) {
        dropdownMenu.querySelectorAll('.resource-type-dropdown-item').forEach(item => {
            item.classList.remove('selected');
        });
    }
    
    focusedNodeId = null;
    navigationStack = [];
    updateBackButtonVisibility();
    
    renderGraph();
}

// Update the resourceType dropdown
function updateResourceTypeTable(data) {
    const resourceTypeCounts = extractResourceTypes(data);
    
    // Remove old table container if it exists
    const oldTableContainer = document.getElementById('resourceTypeTableContainer');
    if (oldTableContainer) {
        oldTableContainer.remove();
    }
    
    // Create dropdown container
    let dropdownContainer = document.getElementById('resourceTypeDropdownContainer');
    if (!dropdownContainer) {
        dropdownContainer = document.createElement('div');
        dropdownContainer.id = 'resourceTypeDropdownContainer';
        dropdownContainer.className = 'resource-type-dropdown-container';
        
        const rightPanel = document.querySelector('.right-panel');
        const panelHeader = rightPanel.querySelector('.panel-header');
        panelHeader.insertAdjacentElement('afterend', dropdownContainer);
    }
    
    dropdownContainer.innerHTML = '';
    
    if (resourceTypeCounts.size === 0) {
        dropdownContainer.innerHTML = '<p class="no-resource-types">No resourceType attributes found in the JSON.</p>';
        return;
    }
    
    // Create dropdown button
    const dropdownButton = document.createElement('button');
    dropdownButton.className = 'resource-type-dropdown-button';
    dropdownButton.id = 'resourceTypeDropdownButton';
    
    if (selectedResourceType) {
        const color = getResourceTypeColor(selectedResourceType);
        const colorIndicator = document.createElement('span');
        colorIndicator.className = 'resource-type-color-indicator';
        colorIndicator.style.backgroundColor = color;
        dropdownButton.appendChild(colorIndicator);
        dropdownButton.appendChild(document.createTextNode(selectedResourceType));
    } else {
        dropdownButton.textContent = 'Filter by Resource Type';
    }
    
    // Create dropdown menu
    const dropdownMenu = document.createElement('div');
    dropdownMenu.className = 'resource-type-dropdown-menu';
    dropdownMenu.id = 'resourceTypeDropdownMenu';
    dropdownMenu.style.display = 'none';
    
    // Add "Clear" option
    const clearOption = document.createElement('div');
    clearOption.className = 'resource-type-dropdown-item';
    clearOption.textContent = 'Clear Filter';
    clearOption.addEventListener('click', (e) => {
        e.stopPropagation();
        clearView();
        closeDropdown();
        renderGraph();
    });
    dropdownMenu.appendChild(clearOption);
    
    // Add separator
    const separator = document.createElement('div');
    separator.className = 'resource-type-dropdown-separator';
    dropdownMenu.appendChild(separator);
    
    // Add resource types
    const sortedEntries = Array.from(resourceTypeCounts.entries())
        .sort((a, b) => {
            if (b[1] !== a[1]) return b[1] - a[1];
            return a[0].localeCompare(b[0]);
        });
    
    sortedEntries.forEach(([resourceType, count]) => {
        const option = document.createElement('div');
        option.className = 'resource-type-dropdown-item';
        if (selectedResourceType === resourceType) {
            option.classList.add('selected');
        }
        
        const color = getResourceTypeColor(resourceType);
        const colorIndicator = document.createElement('span');
        colorIndicator.className = 'resource-type-color-indicator';
        colorIndicator.style.backgroundColor = color;
        
        const label = document.createElement('span');
        label.textContent = resourceType;
        
        const countSpan = document.createElement('span');
        countSpan.className = 'resource-type-count';
        countSpan.textContent = `(${count})`;
        
        option.appendChild(colorIndicator);
        option.appendChild(label);
        option.appendChild(countSpan);
        
        option.addEventListener('click', (e) => {
            e.stopPropagation();
            
            if (isCleared) {
                isCleared = false;
            }
            
            if (selectedResourceType === resourceType) {
                clearView();
            } else {
                selectedResourceType = resourceType;
                // Update button text
                dropdownButton.innerHTML = '';
                dropdownButton.appendChild(colorIndicator.cloneNode(true));
                dropdownButton.appendChild(document.createTextNode(resourceType));
            }
            
            focusedNodeId = null;
            navigationStack = [];
            updateBackButtonVisibility();
            
            closeDropdown();
            renderGraph();
            
            setTimeout(() => {
                fitToView();
            }, 100);
        });
        
        dropdownMenu.appendChild(option);
    });
    
    // Toggle dropdown on button click
    dropdownButton.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleDropdown();
    });
    
    dropdownContainer.appendChild(dropdownButton);
    dropdownContainer.appendChild(dropdownMenu);
}

// Close dropdown when clicking outside (set up once globally)
let dropdownClickHandler = null;
function setupDropdownClickOutside() {
    if (dropdownClickHandler) {
        document.removeEventListener('click', dropdownClickHandler);
    }
    dropdownClickHandler = (e) => {
        const dropdownContainer = document.getElementById('resourceTypeDropdownContainer');
        if (dropdownContainer && !dropdownContainer.contains(e.target)) {
            closeDropdown();
        }
    };
    document.addEventListener('click', dropdownClickHandler);
}

// Initialize dropdown click outside handler
setupDropdownClickOutside();

function toggleDropdown() {
    const dropdownMenu = document.getElementById('resourceTypeDropdownMenu');
    if (dropdownMenu) {
        if (dropdownMenu.style.display === 'none') {
            dropdownMenu.style.display = 'block';
        } else {
            dropdownMenu.style.display = 'none';
        }
    }
}

function closeDropdown() {
    const dropdownMenu = document.getElementById('resourceTypeDropdownMenu');
    if (dropdownMenu) {
        dropdownMenu.style.display = 'none';
    }
}
