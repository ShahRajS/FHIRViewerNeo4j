// Global variables
let jsonData = null;
let nodes = [];
let links = [];
let allNodes = []; // Store all nodes (not just visible ones)
let allLinks = []; // Store all links (not just visible ones)
let simulation = null;
let zoom = null;
let svg = null;
let g = null;
let width = 0;
let height = 0;
let currentTransform = d3.zoomIdentity;
let visibleNodes = new Set();
let maxInitialDepth = 3; // Limit initial depth
let expandedNodes = new Set(); // Track expanded nodes
let renderThrottle = null;
let lastRenderTime = 0;
let lastTickTime = 0;
const RENDER_THROTTLE_MS = 16; // ~60fps
const TICK_THROTTLE_MS = 50; // Update viewport less frequently during simulation
let tickUpdateCounter = 0;
let focusedNodeId = null; // Currently focused node for drill-down
let navigationStack = []; // Stack of node IDs for back navigation
let nodeJsonPath = new Map(); // Map node ID to JSON path for highlighting
let selectedResourceType = null; // Currently selected resourceType filter
let resourceTypeColors = new Map(); // Color mapping for each resourceType
let isCleared = false; // Whether the view has been cleared

// DOM elements
const fileInput = document.getElementById('fileInput');
const uploadBtn = document.getElementById('uploadBtn');
const jsonEditor = document.getElementById('jsonEditor');
const visualizeBtn = document.getElementById('visualizeBtn');
const validIndicator = document.getElementById('validIndicator');
const vizContainer = document.getElementById('vizContainer');
const graphSvg = document.getElementById('graphSvg');
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
        
        // Reset navigation state
        focusedNodeId = null;
        navigationStack = [];
        selectedResourceType = null; // Clear resourceType filter when visualizing new JSON
        isCleared = false; // Reset cleared state when visualizing new JSON
        resourceTypeColors.clear(); // Clear color cache when loading new JSON
        updateBackButtonVisibility();
        
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
                buildGraph(jsonData);
                hideLoadingIndicator();
                renderGraph();
            }, 10);
        } else {
            buildGraph(jsonData);
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
            // Count objects in this array (especially those with resourceType)
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
            
            // Use resourceType count as primary metric, fall back to object count
            const score = resourceTypeCount > 0 ? resourceTypeCount * 1000 + objectCount : objectCount;
            
            // If this array has more objects/resourceTypes, it's the main array
            if (score > maxObjects) {
                maxObjects = score;
                mainArray = obj;
                mainArrayPath = [...currentPath];
            }
        } else if (typeof obj === 'object') {
            // Recursively check all properties
            Object.entries(obj).forEach(([key, value]) => {
                traverse(value, [...currentPath, key]);
            });
        }
    }
    
    traverse(data, path);
    return { array: mainArray, path: mainArrayPath };
}

function buildGraph(data) {
    // Preserve expanded nodes when rebuilding
    const previousExpandedNodes = new Set(expandedNodes);
    
    // Preserve navigation state - we'll try to restore it after rebuilding
    const savedFocusedPath = focusedNodeId !== null 
        ? allNodes.find(n => n.id === focusedNodeId)?.jsonPath 
        : null;
    const savedStackPaths = navigationStack.map(id => 
        allNodes.find(n => n.id === id)?.jsonPath
    ).filter(p => p !== undefined);
    
    // Find the main array with the most sub-objects
    const mainArrayInfo = findMainArray(data);
    let rootData = data;
    let rootKey = 'root';
    
    // If we found a main array, use it as the root
    if (mainArrayInfo.array && mainArrayInfo.array.length > 0) {
        rootData = mainArrayInfo.array;
        // Use the last part of the path as the root key (e.g., "entry" for FHIR bundles)
        rootKey = mainArrayInfo.path.length > 0 
            ? mainArrayInfo.path[mainArrayInfo.path.length - 1] 
            : 'main';
    }
    
    allNodes = [];
    allLinks = [];
    nodes = [];
    links = [];
    nodeJsonPath.clear();
    const nodeMap = new Map();
    let nodeId = 0;
    
    function createNode(label, value, type, parentId = null, depth = 0, rawData = null, childrenCount = 0, isCollapsed = false, jsonPath = null, resourceType = null) {
        const id = nodeId++;
        const node = {
            id,
            label,
            value,
            type,
            parentId,
            depth,
            rawData, // Store original data for lazy expansion
            childrenCount,
            isCollapsed: isCollapsed || (depth >= maxInitialDepth && childrenCount > 0),
            x: Math.random() * 800 + 400,
            y: Math.random() * 600 + 300,
            children: [], // Store child node IDs
            jsonPath: jsonPath || [], // Store path in JSON for highlighting
            resourceType: resourceType || null // Store resourceType for filtering
        };
        
        // Store JSON path mapping
        if (jsonPath) {
            nodeJsonPath.set(id, jsonPath);
        }
        
        if (parentId !== null) {
            const linkData = {
                source: parentId,
                target: id,
                label: label,
                id: `link-${parentId}-${id}`
            };
            allLinks.push(linkData);
            const parentNode = nodeMap.get(parentId);
            if (parentNode) {
                parentNode.children.push(id);
            }
        }
        
        allNodes.push(node);
        nodeMap.set(id, node);
        return id;
    }
    
    function processValue(value, parentId, key = 'root', depth = 0, parentPath = [], parentResourceType = null) {
        const currentPath = parentId === null ? [] : [...parentPath, key];
        
        // Check if this object has a resourceType
        let currentResourceType = parentResourceType;
        if (value !== null && typeof value === 'object' && !Array.isArray(value) && value.resourceType) {
            currentResourceType = value.resourceType;
        }
        
        if (value === null) {
            return createNode(key, 'null', 'null', parentId, depth, null, 0, false, currentPath, currentResourceType);
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
                depth >= maxInitialDepth,
                currentPath,
                currentResourceType
            );
            
            // Check if node should be expanded
            const shouldExpand = depth < maxInitialDepth || previousExpandedNodes.has(arrayNodeId) || expandedNodes.has(arrayNodeId);
            if (shouldExpand) {
                value.forEach((item, index) => {
                    processValue(item, arrayNodeId, key, depth + 1, currentPath, currentResourceType);
                });
            }
            return arrayNodeId;
        } else if (valueType === 'object') {
            const keys = Object.keys(value);
            // If object has a resourceType, use that as the label instead of the key
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
                depth >= maxInitialDepth,
                currentPath,
                currentResourceType
            );
            
            // Check if node should be expanded
            const shouldExpand = depth < maxInitialDepth || previousExpandedNodes.has(objNodeId) || expandedNodes.has(objNodeId);
            if (shouldExpand) {
                Object.entries(value).forEach(([k, v]) => {
                    processValue(v, objNodeId, k, depth + 1, currentPath, currentResourceType);
                });
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
                return createNode(labelText, value, 'color', parentId, depth, null, 0, false, currentPath, currentResourceType);
            } else {
                labelText = `${key}: ${displayValue}`;
            }
            
            return createNode(labelText, value, valueType, parentId, depth, null, 0, false, currentPath, currentResourceType);
        }
    }
    
    // Process the root data (either the main array or the original data)
    if (typeof rootData === 'object' && rootData !== null) {
        processValue(rootData, null, rootKey, 0, []);
    } else {
        createNode(rootKey, String(rootData), typeof rootData, null, 0, null, 0, false, []);
    }
    
    // Restore navigation state by finding nodes with matching paths
    if (savedFocusedPath) {
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
    
    // Restore navigation stack
    if (savedStackPaths.length > 0) {
        navigationStack = savedStackPaths.map(path => {
            const node = allNodes.find(n => 
                n.jsonPath && 
                n.jsonPath.length === path.length &&
                n.jsonPath.every((val, idx) => val === path[idx])
            );
            return node?.id;
        }).filter(id => id !== undefined);
    }
    
    // Initially, all nodes are in the visible set
    updateVisibleNodes();
    
    // Update back button visibility
    updateBackButtonVisibility();
}

function initializeVisualization() {
    width = vizContainer.clientWidth;
    height = vizContainer.clientHeight;
    
    svg = d3.select('#graphSvg')
        .attr('width', width)
        .attr('height', height);
    
    g = svg.append('g');
    
    // Set up zoom behavior with throttled updates
    zoom = d3.zoom()
        .scaleExtent([0.1, 4])
        .on('zoom', (event) => {
            currentTransform = event.transform;
            g.attr('transform', event.transform);
            throttledUpdateViewport();
        });
    
    svg.call(zoom);
    
    // Handle window resize
    window.addEventListener('resize', () => {
        width = vizContainer.clientWidth;
        height = vizContainer.clientHeight;
        svg.attr('width', width).attr('height', height);
        if (nodes.length > 0) {
            fitToView();
        }
    });
}

// Throttled viewport update
function throttledUpdateViewport() {
    const now = performance.now();
    if (now - lastRenderTime < RENDER_THROTTLE_MS) {
        if (renderThrottle) {
            cancelAnimationFrame(renderThrottle);
        }
        renderThrottle = requestAnimationFrame(() => {
            updateVisibleNodes();
            renderVisibleGraph();
        });
        return;
    }
    lastRenderTime = now;
    updateVisibleNodes();
    renderVisibleGraph();
}

// Calculate which nodes are visible in viewport
function updateVisibleNodes() {
    if (allNodes.length === 0) return;
    
    visibleNodes.clear();
    
    // If filtering by resourceType, include matching nodes AND their parent tree
    if (selectedResourceType !== null) {
        // Find all nodes matching the selected resourceType
        const matchingNodes = allNodes.filter(n => n.resourceType === selectedResourceType);
        
        // For each matching node, add it and all its ancestors (parent tree)
        matchingNodes.forEach(matchingNode => {
            // Add the matching node itself
            visibleNodes.add(matchingNode.id);
            
            // Trace back to root by following parentId chain
            let currentNode = matchingNode;
            while (currentNode.parentId !== null) {
                const parentNode = allNodes.find(n => n.id === currentNode.parentId);
                if (parentNode) {
                    visibleNodes.add(parentNode.id);
                    currentNode = parentNode;
                } else {
                    break;
                }
            }
        });
        return;
    }
    
    // Otherwise, use viewport-based visibility for performance
    // Get viewport bounds in transformed coordinates
    const transform = currentTransform;
    const k = transform.k;
    const x0 = -transform.x / k;
    const y0 = -transform.y / k;
    const x1 = x0 + width / k;
    const y1 = y0 + height / k;
    
    // Add padding to load nodes slightly outside viewport
    const padding = 200 / k;
    
    allNodes.forEach(node => {
        // Skip collapsed nodes (unless they have collapsed children that might be visible)
        if (node.isCollapsed && node.parentId !== null) {
            // Only show if the collapsed node itself is visible
            if (node.x + node.width/2 >= x0 - padding &&
                node.x - node.width/2 <= x1 + padding &&
                node.y + node.height/2 >= y0 - padding &&
                node.y - node.height/2 <= y1 + padding) {
                visibleNodes.add(node.id);
            }
            return;
        }
        
        // Check if node is in viewport
        if (node.x + node.width/2 >= x0 - padding &&
            node.x - node.width/2 <= x1 + padding &&
            node.y + node.height/2 >= y0 - padding &&
            node.y - node.height/2 <= y1 + padding) {
            visibleNodes.add(node.id);
            
            // Also add parent if not already visible (for links)
            if (node.parentId !== null) {
                visibleNodes.add(node.parentId);
            }
        }
    });
    
    // Always include root node
    if (allNodes.length > 0) {
        visibleNodes.add(allNodes[0].id);
    }
}

// Clear the view - remove all nodes
function clearView() {
    isCleared = true;
    selectedResourceType = null;
    
    // Remove selection from all table rows
    const tableContainer = document.getElementById('resourceTypeTableContainer');
    if (tableContainer) {
        tableContainer.querySelectorAll('.resource-type-row').forEach(r => {
            r.classList.remove('selected');
        });
    }
    
    // Clear focus and navigation
    focusedNodeId = null;
    navigationStack = [];
    updateBackButtonVisibility();
    
    // Clear all nodes from view
    nodes = [];
    links = [];
    
    // Remove all nodes and links from DOM
    if (g) {
        g.selectAll('.node').remove();
        g.selectAll('.link').remove();
    }
    
    // Stop simulation
    if (simulation) {
        simulation.stop();
        simulation = null;
    }
    
    // Update the visualization to reflect cleared state
    renderVisibleGraph();
}

// Build visible nodes and links arrays
function buildVisibleGraph() {
    // If view is cleared, show nothing
    if (isCleared && selectedResourceType === null) {
        nodes = [];
        links = [];
        return;
    }
    
    // If filtering by resourceType, include matching nodes AND their parent tree
    if (selectedResourceType !== null) {
        const visibleNodeIds = new Set();
        
        // Find all nodes matching the selected resourceType
        const matchingNodes = allNodes.filter(n => n.resourceType === selectedResourceType);
        
        // For each matching node, add it and all its ancestors (parent tree)
        matchingNodes.forEach(matchingNode => {
            // Add the matching node itself
            visibleNodeIds.add(matchingNode.id);
            
            // Trace back to root by following parentId chain
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
        
        // Filter nodes to only include those in our visible set
        // (Only matching nodes and their parent tree - no descendants)
        nodes = allNodes.filter(n => visibleNodeIds.has(n.id));
        
        // If focused on a node, only show that node and its ancestors (within the filtered set)
        if (focusedNodeId !== null) {
            const focusedNode = nodes.find(n => n.id === focusedNodeId);
            if (focusedNode) {
                const focusedNodeIds = new Set([focusedNodeId]);
                // Add ancestors of focused node
                let currentNode = focusedNode;
                while (currentNode.parentId !== null) {
                    if (visibleNodeIds.has(currentNode.parentId)) {
                        focusedNodeIds.add(currentNode.parentId);
                        currentNode = nodes.find(n => n.id === currentNode.parentId);
                        if (!currentNode) break;
                    } else {
                        break;
                    }
                }
                nodes = nodes.filter(n => focusedNodeIds.has(n.id));
            } else {
                nodes = [];
            }
        }
    } else {
        // No resourceType filter - use normal logic
        let candidateNodes = allNodes;
        
        // If focused on a node, only show that node and its children
        if (focusedNodeId !== null) {
            const focusedNode = candidateNodes.find(n => n.id === focusedNodeId);
            if (focusedNode) {
                const descendantIds = new Set([focusedNodeId]);
                function addDescendants(nodeId) {
                    const node = candidateNodes.find(n => n.id === nodeId);
                    if (node && node.children) {
                        node.children.forEach(childId => {
                            descendantIds.add(childId);
                            addDescendants(childId);
                        });
                    }
                }
                addDescendants(focusedNodeId);
                nodes = candidateNodes.filter(n => descendantIds.has(n.id) && visibleNodes.has(n.id));
            } else {
                nodes = [];
            }
        } else {
            // Normal viewport-based filtering when no filter is active
            nodes = candidateNodes.filter(n => visibleNodes.has(n.id));
        }
    }
    
    // Filter links to only include those where both source and target are visible
    const visibleNodeIds = new Set(nodes.map(n => n.id));
    links = allLinks.filter(link => {
        const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
        const targetId = typeof link.target === 'object' ? link.target.id : link.target;
        return visibleNodeIds.has(sourceId) && visibleNodeIds.has(targetId);
    });
}

function renderGraph() {
    if (allNodes.length === 0) return;
    
    tickUpdateCounter = 0;
    lastTickTime = 0;
    
    // Calculate node sizes for all nodes first
    allNodes.forEach(node => {
        const text = node.label;
        const lines = text.split('\n').length;
        const maxLineLength = Math.max(...text.split('\n').map(l => l.length));
        node.width = Math.max(120, maxLineLength * 7 + 30);
        node.height = Math.max(40, lines * 20 + 20);
        
        // Add collapsed indicator (store original label)
        node.originalLabel = node.label;
        if (node.isCollapsed && node.childrenCount > 0) {
            node.label = node.label + ' ▶';
        }
    });
    
    // For very large graphs, reduce simulation iterations
    const isLargeGraph = allNodes.length > 1000;
    const alphaTarget = isLargeGraph ? 0.1 : 0.3;
    
    // Run force simulation on all nodes (but we'll only render visible ones)
    if (simulation) {
        simulation.stop();
    }
    
    simulation = d3.forceSimulation(allNodes)
        .force('link', d3.forceLink(allLinks).id(d => d.id).distance(150))
        .force('charge', d3.forceManyBody().strength(-300))
        .force('center', d3.forceCenter(width / 2, height / 2))
        .force('collision', d3.forceCollide().radius(d => Math.max(d.width, d.height) / 2 + 10))
        .alphaDecay(isLargeGraph ? 0.05 : 0.02)
        .velocityDecay(0.4)
        .on('tick', () => {
            // Throttle viewport updates during simulation
            tickUpdateCounter++;
            const now = performance.now();
            if (now - lastTickTime > TICK_THROTTLE_MS || tickUpdateCounter % 3 === 0) {
                updateVisibleNodes();
                buildVisibleGraph();
                renderVisibleGraph();
                lastTickTime = now;
            } else {
                // Still update positions of visible nodes
                renderVisibleGraph();
            }
        })
        .on('end', () => {
            // Final render when simulation ends
            updateVisibleNodes();
            buildVisibleGraph();
            renderVisibleGraph();
        });
    
    // Initial viewport update
    updateVisibleNodes();
    buildVisibleGraph();
    renderVisibleGraph();
    
    // Auto-stop simulation after a timeout for large graphs
    if (isLargeGraph) {
        setTimeout(() => {
            if (simulation && simulation.alpha() > 0.05) {
                simulation.alpha(0.05);
            }
        }, 2000);
    }
    
    // Fit to view after initial render
    setTimeout(() => {
        if (simulation) {
            simulation.stop();
        }
        fitToView();
    }, 500);
}

// Render only visible nodes and links
function renderVisibleGraph() {
    // If filtering by resourceType, ensure we remove ALL nodes not in the filtered set
    if (selectedResourceType !== null) {
        const visibleNodeIds = new Set(nodes.map(n => n.id));
        
        // Force remove any nodes that aren't in our filtered set
        g.selectAll('.node').each(function(d) {
            if (!visibleNodeIds.has(d.id)) {
                d3.select(this).remove();
            }
        });
        
        // Force remove any links that aren't in our filtered set
        const visibleLinkIds = new Set(links.map(l => l.id || `link-${l.source.id || l.source}-${l.target.id || l.target}`));
        g.selectAll('.link').each(function(d) {
            const linkId = d.id || `link-${d.source.id || d.source}-${d.target.id || d.target}`;
            if (!visibleLinkIds.has(linkId)) {
                d3.select(this).remove();
            }
        });
    }
    
    if (nodes.length === 0 && selectedResourceType !== null) {
        // If no nodes match but we're filtering, ensure everything is removed
        g.selectAll('.node').remove();
        g.selectAll('.link').remove();
        return;
    }
    
    if (nodes.length === 0) return;
    
    // Update or create links
    const linkSelection = g.select('.links');
    let linksGroup = linkSelection.empty() 
        ? g.append('g').attr('class', 'links')
        : linkSelection;
    
    const link = linksGroup
        .selectAll('path.link')
        .data(links, d => d.id || `link-${d.source.id || d.source}-${d.target.id || d.target}`);
    
    link.exit().remove();
    
    const linkEnter = link.enter()
        .append('path')
        .attr('class', 'link');
    
    const linkUpdate = linkEnter.merge(link);
    
    linkUpdate.attr('d', d => {
        const sourceId = typeof d.source === 'object' ? d.source.id : d.source;
        const targetId = typeof d.target === 'object' ? d.target.id : d.target;
        const source = allNodes.find(n => n.id === sourceId);
        const target = allNodes.find(n => n.id === targetId);
        if (!source || !target) return '';
        
        const sx = source.x;
        const sy = source.y;
        const tx = target.x;
        const ty = target.y;
        
        const dx = tx - sx;
        const dy = ty - sy;
        const dr = Math.sqrt(dx * dx + dy * dy) * 1.5;
        
        return `M ${sx} ${sy} A ${dr} ${dr} 0 0,1 ${tx} ${ty}`;
    });
    
    // Update or create nodes
    const nodeSelection = g.select('.nodes');
    let nodesGroup = nodeSelection.empty()
        ? g.append('g').attr('class', 'nodes')
        : nodeSelection;
    
    const node = nodesGroup
        .selectAll('g.node')
        .data(nodes, d => d.id);
    
    // Remove all nodes that don't match the current filter
    node.exit().remove();
    
    const nodeEnter = node.enter()
        .append('g')
        .attr('class', d => {
            let classes = `node ${d.type}`;
            if (d.isCollapsed) classes += ' collapsed';
            if (d.id === focusedNodeId) classes += ' focused';
            return classes;
        })
        .style('cursor', 'pointer');
    
    // Add rectangle
    nodeEnter.append('rect')
        .attr('width', d => d.width)
        .attr('height', d => d.height)
        .attr('rx', 6)
        .attr('fill', d => {
            if (d.type === 'color' && d.value) {
                return d.value;
            }
            // Use resourceType color if available
            if (d.resourceType) {
                return getResourceTypeColor(d.resourceType);
            }
            return 'white';
        })
        .attr('stroke', d => {
            // Use darker version of resourceType color for border
            if (d.resourceType) {
                return d3.rgb(getResourceTypeColor(d.resourceType)).darker(1.5);
            }
            return '#333';
        })
        .attr('stroke-width', 2);
    
    // Add text
    nodeEnter.append('text')
        .attr('x', d => d.width / 2)
        .attr('y', d => d.height / 2)
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'middle')
        .attr('class', 'node-title')
        .attr('fill', d => {
            // Use white text on colored backgrounds for better contrast
            if (d.resourceType) {
                const color = d3.rgb(getResourceTypeColor(d.resourceType));
                // Calculate luminance to determine if we need white or black text
                const luminance = (0.299 * color.r + 0.587 * color.g + 0.114 * color.b) / 255;
                return luminance > 0.5 ? '#000' : '#fff';
            }
            return '#333';
        })
        .text(d => d.originalLabel || d.label.replace(' ▶', '')); // Use original label
    
    // Add color circle for color nodes
    nodeEnter.filter(d => d.type === 'color')
        .append('circle')
        .attr('cx', d => d.width - 20)
        .attr('cy', d => d.height / 2)
        .attr('r', 8)
        .attr('fill', d => d.value || 'white')
        .attr('stroke', '#333')
        .attr('stroke-width', 1);
    
    // Add click handler for all nodes
    nodeEnter.on('click', (event, d) => {
        event.stopPropagation();
        
        // Handle collapsed nodes - expand them
        if (d.isCollapsed && d.childrenCount > 0) {
            toggleNode(d, event);
        } else if (d.childrenCount > 0 || d.type === 'object' || d.type === 'array') {
            // Navigate into this node (drill-down)
            focusOnNode(d);
        } else {
            // Leaf node - just highlight JSON
            highlightJsonForNode(d);
        }
    });
    
    const nodeUpdate = nodeEnter.merge(node);
    
    // Update classes for focused state
    nodeUpdate.attr('class', d => {
        let classes = `node ${d.type}`;
        if (d.isCollapsed) classes += ' collapsed';
        if (d.id === focusedNodeId) classes += ' focused';
        return classes;
    });
    
    // Update fill and stroke colors for existing nodes
    nodeUpdate.select('rect')
        .attr('fill', d => {
            if (d.type === 'color' && d.value) {
                return d.value;
            }
            if (d.resourceType) {
                return getResourceTypeColor(d.resourceType);
            }
            return 'white';
        })
        .attr('stroke', d => {
            if (d.resourceType) {
                return d3.rgb(getResourceTypeColor(d.resourceType)).darker(1.5);
            }
            return '#333';
        });
    
    // Update text color for existing nodes
    nodeUpdate.select('text')
        .attr('fill', d => {
            if (d.resourceType) {
                const color = d3.rgb(getResourceTypeColor(d.resourceType));
                const luminance = (0.299 * color.r + 0.587 * color.g + 0.114 * color.b) / 255;
                return luminance > 0.5 ? '#000' : '#fff';
            }
            return '#333';
        });
    
    nodeUpdate.attr('transform', d => `translate(${d.x - d.width/2}, ${d.y - d.height/2})`);
    
    // Make nodes draggable
    nodeUpdate.call(d3.drag()
        .on('start', dragStarted)
        .on('drag', dragged)
        .on('end', dragEnded));
}

function toggleNode(node, event) {
    if (event) {
        event.stopPropagation();
    }
    
    if (!node.isCollapsed) {
        // Collapse: remove children
        expandedNodes.delete(node.id);
    } else {
        // Expand: add children
        expandedNodes.add(node.id);
    }
    
    // Rebuild graph with updated expansion state
    buildGraph(jsonData);
    renderGraph();
}

function rebuildNodeChildren(node) {
    // This will be called when expanding - for now, we'll rebuild the whole graph
    // A more optimized version would only rebuild the subtree
}

// Focus on a node (drill-down view)
function focusOnNode(node) {
    // Highlight JSON first
    highlightJsonForNode(node);
    
    // Add current focus to navigation stack if not already focused
    if (focusedNodeId !== node.id) {
        if (focusedNodeId !== null) {
            navigationStack.push(focusedNodeId);
        }
        focusedNodeId = node.id;
    }
    
    // Update back button visibility
    updateBackButtonVisibility();
    
    // Rebuild visible graph and render
    // First, we need to rebuild the graph to ensure all children are created if node is collapsed
    if (node.isCollapsed && node.rawData && (node.type === 'object' || node.type === 'array')) {
        // Make sure node is expanded so children exist
        expandedNodes.add(node.id);
        buildGraph(jsonData);
    } else {
        // Node is already expanded, just update the view
        updateVisibleNodes();
        buildVisibleGraph();
        renderVisibleGraph();
    }
    
    // Fit to new view
    setTimeout(() => {
        fitToView();
    }, 100);
}

// Navigate back one level
function navigateBack() {
    if (navigationStack.length > 0) {
        focusedNodeId = navigationStack.pop();
        updateBackButtonVisibility();
        
        // Highlight JSON for the node we're going back to
        const node = allNodes.find(n => n.id === focusedNodeId);
        if (node) {
            highlightJsonForNode(node);
        }
    } else {
        // Go back to root view
        focusedNodeId = null;
        updateBackButtonVisibility();
        clearJsonHighlight();
    }
    
    // Rebuild visible graph and render
    updateVisibleNodes();
    buildVisibleGraph();
    renderVisibleGraph();
    
    // Fit to new view
    setTimeout(() => {
        fitToView();
    }, 100);
}

// Update back button visibility
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
        // Root node - highlight entire JSON
        highlightJsonRange(0, jsonEditor.value.length);
        return;
    }
    
    // Find the JSON location based on path
    const location = findJsonPathLocation(jsonData, node.jsonPath, jsonEditor.value);
    if (location) {
        highlightJsonRange(location.start, location.end);
        // Scroll to the highlighted section
        scrollToJsonPosition(location.start);
    }
}

// Find the character range in JSON text for a given path (simplified approach)
function findJsonPathLocation(data, path, jsonText) {
    if (!path || path.length === 0) {
        return { start: 0, end: jsonText.length };
    }
    
    try {
        // Build a JSONPath-like pattern to find in the text
        // Start from the beginning and navigate through the path
        let searchOffset = 0;
        let current = data;
        
        for (let i = 0; i < path.length; i++) {
            const key = path[i];
            
            if (Array.isArray(current)) {
                const index = parseInt(key);
                if (isNaN(index) || index >= current.length) return null;
                current = current[index];
                
                // For arrays, find the nth item
                const result = findNthArrayItem(jsonText, searchOffset, index);
                if (!result) return null;
                searchOffset = result.start;
            } else if (typeof current === 'object' && current !== null) {
                if (!(key in current)) return null;
                current = current[key];
                
                // Find the property key: value in the text
                const result = findPropertyLocation(jsonText, key, searchOffset);
                if (!result) return null;
                
                // If this is the last element, return the value range
                if (i === path.length - 1) {
                    return {
                        start: result.valueStart,
                        end: result.valueEnd
                    };
                }
                
                // Otherwise, continue searching within the value
                searchOffset = result.valueStart;
            } else {
                return null;
            }
        }
        
        // If we get here, we need to find the value at searchOffset
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

// Find the nth item in an array starting from offset
function findNthArrayItem(text, startOffset, targetIndex) {
    let depth = 0;
    let inString = false;
    let escapeNext = false;
    let currentIndex = 0;
    let itemStart = -1;
    
    // Find the opening bracket
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
    
    // Check if it's the last item
    if (currentIndex === targetIndex && itemStart !== -1) {
        const closingBracket = text.indexOf(']', bracketPos);
        return { start: itemStart, end: closingBracket > -1 ? closingBracket : text.length };
    }
    
    return null;
}

// Find a property location in JSON text
function findPropertyLocation(text, key, startOffset) {
    // Escape key for regex
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`"${escapedKey}"\\s*:`, 'g');
    
    regex.lastIndex = startOffset;
    const match = regex.exec(text);
    
    if (!match) return null;
    
    const keyStart = match.index;
    const colonEnd = match.index + match[0].length;
    
    // Skip whitespace
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

// Helper function to find array item in JSON text
function findArrayItemInText(text, index, startOffset) {
    let depth = 0;
    let inString = false;
    let escapeNext = false;
    let currentIndex = -1;
    let itemStart = -1;
    let bracketCount = 0;
    
    for (let i = startOffset; i < text.length; i++) {
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
        
        if (char === '[') {
            if (depth === 0) {
                currentIndex = -1;
                itemStart = i + 1;
            }
            bracketCount++;
        } else if (char === ']') {
            bracketCount--;
            if (bracketCount === 0 && currentIndex === index) {
                return {
                    offset: itemStart,
                    text: text.substring(itemStart, i)
                };
            }
        } else if (char === '{') {
            depth++;
        } else if (char === '}') {
            depth--;
        } else if (char === ',' && depth === 0 && bracketCount === 1) {
            currentIndex++;
            if (currentIndex === index) {
                return {
                    offset: itemStart,
                    text: text.substring(itemStart, i)
                };
            }
            itemStart = i + 1;
        }
    }
    
    // Handle last item
    if (currentIndex + 1 === index) {
        return {
            offset: itemStart,
            text: text.substring(itemStart)
        };
    }
    
    return null;
}

// Helper function to find property in JSON text
function findPropertyInText(text, key, startOffset) {
    const keyPattern = new RegExp(`"${key.replace(/"/g, '\\"')}"\\s*:`, 'g');
    let match;
    
    // Search from startOffset
    const searchText = text.substring(startOffset);
    keyPattern.lastIndex = 0;
    match = keyPattern.exec(searchText);
    
    if (match) {
        const keyStart = startOffset + match.index;
        const colonPos = startOffset + match.index + match[0].length;
        
        // Find the value start (skip whitespace after colon)
        let valueStart = colonPos;
        while (valueStart < text.length && /\s/.test(text[valueStart])) {
            valueStart++;
        }
        
        // Find the value end
        const valueEnd = findValueEnd(text, valueStart);
        
        return {
            start: keyStart,
            valueStart: valueStart,
            valueEnd: valueEnd
        };
    }
    
    return null;
}

// Helper function to find where a JSON value ends
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



// Highlight a range in the JSON editor
let highlightTimeout = null;
function highlightJsonRange(start, end) {
    // Clear previous highlight
    clearJsonHighlight();
    
    // Select the range
    jsonEditor.focus();
    jsonEditor.setSelectionRange(start, end);
    
    // Add a temporary highlight class via CSS (we'll add this)
    // For now, we'll just scroll to it
    
    // Clear highlight after 3 seconds
    if (highlightTimeout) {
        clearTimeout(highlightTimeout);
    }
    highlightTimeout = setTimeout(() => {
        jsonEditor.setSelectionRange(start, start);
    }, 3000);
}

// Clear JSON highlight
function clearJsonHighlight() {
    if (highlightTimeout) {
        clearTimeout(highlightTimeout);
        highlightTimeout = null;
    }
    // Selection will be cleared when user interacts
}

// Scroll JSON editor to a position
function scrollToJsonPosition(position) {
    const textBefore = jsonEditor.value.substring(0, position);
    const lines = textBefore.split('\n');
    const lineNumber = lines.length - 1;
    
    // Calculate approximate scroll position
    const lineHeight = 20; // Approximate line height in pixels
    const visibleLines = jsonEditor.clientHeight / lineHeight;
    const targetScroll = Math.max(0, (lineNumber - visibleLines / 2) * lineHeight);
    
    jsonEditor.scrollTop = targetScroll;
}

function dragStarted(event, d) {
    if (!event.active && simulation) {
        simulation.alphaTarget(0.3).restart();
    }
    const node = allNodes.find(n => n.id === d.id);
    if (node) {
        node.fx = node.x;
        node.fy = node.y;
    }
}

function dragged(event, d) {
    const node = allNodes.find(n => n.id === d.id);
    if (node) {
        node.fx = event.x;
        node.fy = event.y;
    }
}

function dragEnded(event, d) {
    if (!event.active && simulation) {
        simulation.alphaTarget(0);
    }
    const node = allNodes.find(n => n.id === d.id);
    if (node) {
        node.fx = null;
        node.fy = null;
    }
}

function zoomIn() {
    svg.transition().call(zoom.scaleBy, 1.2);
}

function zoomOut() {
    svg.transition().call(zoom.scaleBy, 0.8);
}

function fitToView() {
    if (allNodes.length === 0) return;
    
    // Use filtered nodes if a resourceType filter is active
    let nodesToFit = allNodes;
    if (selectedResourceType !== null) {
        nodesToFit = allNodes.filter(n => n.resourceType === selectedResourceType);
        if (nodesToFit.length === 0) return; // No nodes to fit
    }
    
    // Calculate bounds from nodes to fit
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    nodesToFit.forEach(node => {
        minX = Math.min(minX, node.x - node.width/2);
        minY = Math.min(minY, node.y - node.height/2);
        maxX = Math.max(maxX, node.x + node.width/2);
        maxY = Math.max(maxY, node.y + node.height/2);
    });
    
    const boundsWidth = maxX - minX;
    const boundsHeight = maxY - minY;
    const midX = (minX + maxX) / 2;
    const midY = (minY + maxY) / 2;
    
    const fullWidth = width;
    const fullHeight = height;
    const widthScale = fullWidth / boundsWidth;
    const heightScale = fullHeight / boundsHeight;
    const scale = Math.min(widthScale, heightScale, 1) * 0.9;
    
    svg.transition()
        .duration(750)
        .call(
            zoom.transform,
            d3.zoomIdentity
                .translate(fullWidth / 2 - scale * midX, fullHeight / 2 - scale * midY)
                .scale(scale)
        );
    
    // Update viewport after transform
    setTimeout(() => {
        updateVisibleNodes();
        buildVisibleGraph();
        renderVisibleGraph();
    }, 100);
}

function handleSearch() {
    const searchTerm = searchInput.value.toLowerCase().trim();
    
    if (!searchTerm) {
        g.selectAll('.node').classed('highlighted', false);
        return;
    }
    
    // Highlight matching nodes (check all nodes, not just visible)
    allNodes.forEach(node => {
        if (node.label.toLowerCase().includes(searchTerm)) {
            // Expand path to node if needed
            expandPathToNode(node.id);
        }
    });
    
    // Rebuild and render
    buildGraph(jsonData);
    renderGraph();
    
    // Highlight visible matching nodes
    g.selectAll('.node')
        .classed('highlighted', d => {
            return d.label.toLowerCase().includes(searchTerm);
        });
}

function expandPathToNode(nodeId) {
    // Expand all parent nodes up to the root
    let currentId = nodeId;
    while (currentId !== null) {
        expandedNodes.add(currentId);
        const node = allNodes.find(n => n.id === currentId);
        if (node && node.parentId !== null) {
            currentId = node.parentId;
        } else {
            break;
        }
    }
}

// Auto-validate JSON on paste
jsonEditor.addEventListener('paste', () => {
    setTimeout(validateJSON, 10);
});

// Generate a color for a resourceType
function getResourceTypeColor(resourceType) {
    if (!resourceType) return '#ffffff';
    
    if (!resourceTypeColors.has(resourceType)) {
        // Generate a color based on the resourceType name
        // Use a color palette that's visually distinct
        const colors = [
            '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7',
            '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E2',
            '#F8B739', '#6C5CE7', '#A29BFE', '#FD79A8', '#00B894',
            '#E17055', '#81ECEC', '#74B9FF', '#A29BFE', '#FDCB6E',
            '#E84393', '#00CEC9', '#6C5CE7', '#FF7675', '#00B894'
        ];
        
        // Use hash of resourceType name to pick a consistent color
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
        
        // If it's an object with resourceType property
        if (typeof obj === 'object' && !Array.isArray(obj) && obj.resourceType) {
            const resourceType = obj.resourceType;
            resourceTypeCounts.set(resourceType, (resourceTypeCounts.get(resourceType) || 0) + 1);
        }
        
        // Recursively traverse arrays and objects
        if (Array.isArray(obj)) {
            obj.forEach(item => traverse(item));
        } else if (typeof obj === 'object') {
            Object.values(obj).forEach(value => traverse(value));
        }
    }
    
    traverse(data);
    return resourceTypeCounts;
}

// Update the resourceType table
function updateResourceTypeTable(data) {
    const resourceTypeCounts = extractResourceTypes(data);
    
    // Get or create the table container
    let tableContainer = document.getElementById('resourceTypeTableContainer');
    if (!tableContainer) {
        tableContainer = document.createElement('div');
        tableContainer.id = 'resourceTypeTableContainer';
        tableContainer.className = 'resource-type-table-container';
        
        // Insert before the visualization panel
        const rightPanel = document.querySelector('.right-panel');
        const panelHeader = rightPanel.querySelector('.panel-header');
        panelHeader.insertAdjacentElement('afterend', tableContainer);
    }
    
    // Clear existing content
    tableContainer.innerHTML = '';
    
    if (resourceTypeCounts.size === 0) {
        tableContainer.innerHTML = '<p class="no-resource-types">No resourceType attributes found in the JSON.</p>';
        return;
    }
    
    // Create table
    const table = document.createElement('table');
    table.className = 'resource-type-table';
    
    // Create header with clear button
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    
    const headerCell1 = document.createElement('th');
    headerCell1.style.textAlign = 'left';
    headerCell1.style.padding = '12px 15px';
    
    const headerText = document.createElement('span');
    headerText.textContent = 'Resource Type';
    
    const clearBtn = document.createElement('button');
    clearBtn.className = 'btn btn-clear';
    clearBtn.textContent = 'Clear';
    clearBtn.style.padding = '4px 12px';
    clearBtn.style.fontSize = '12px';
    clearBtn.style.marginLeft = '10px';
    
    clearBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        clearView();
    });
    
    headerCell1.appendChild(headerText);
    headerCell1.appendChild(clearBtn);
    
    const headerCell2 = document.createElement('th');
    headerCell2.textContent = 'Count';
    headerCell2.style.textAlign = 'right';
    headerCell2.style.padding = '12px 15px';
    
    headerRow.appendChild(headerCell1);
    headerRow.appendChild(headerCell2);
    thead.appendChild(headerRow);
    table.appendChild(thead);
    
    // Create body
    const tbody = document.createElement('tbody');
    
    // Sort by count (descending), then by name
    const sortedEntries = Array.from(resourceTypeCounts.entries())
        .sort((a, b) => {
            if (b[1] !== a[1]) return b[1] - a[1]; // Sort by count descending
            return a[0].localeCompare(b[0]); // Then by name ascending
        });
    
    sortedEntries.forEach(([resourceType, count]) => {
        const row = document.createElement('tr');
        row.className = 'resource-type-row';
        if (selectedResourceType === resourceType) {
            row.classList.add('selected');
        }
        
        // Get color for this resourceType
        const color = getResourceTypeColor(resourceType);
        
        // Create color indicator
        const colorIndicator = document.createElement('span');
        colorIndicator.className = 'resource-type-color-indicator';
        colorIndicator.style.backgroundColor = color;
        colorIndicator.style.display = 'inline-block';
        colorIndicator.style.width = '12px';
        colorIndicator.style.height = '12px';
        colorIndicator.style.borderRadius = '50%';
        colorIndicator.style.marginRight = '8px';
        colorIndicator.style.verticalAlign = 'middle';
        
        const typeCell = document.createElement('td');
        typeCell.appendChild(colorIndicator);
        typeCell.appendChild(document.createTextNode(resourceType));
        
        const countCell = document.createElement('td');
        countCell.textContent = count;
        
        row.appendChild(typeCell);
        row.appendChild(countCell);
        
        // Add click handler
        row.addEventListener('click', () => {
            // If view is cleared, un-clear it when selecting a resourceType
            if (isCleared) {
                isCleared = false;
            }
            
            // Toggle selection: if already selected, clear the view
            if (selectedResourceType === resourceType) {
                clearView();
                return;
            } else {
                // Remove selection from all rows
                tableContainer.querySelectorAll('.resource-type-row').forEach(r => {
                    r.classList.remove('selected');
                });
                selectedResourceType = resourceType;
                row.classList.add('selected');
            }
            
            // Clear focus and navigation when filtering
            focusedNodeId = null;
            navigationStack = [];
            updateBackButtonVisibility();
            
            // Rebuild and render graph with filter
            updateVisibleNodes();
            buildVisibleGraph();
            
            // Force complete removal of non-matching nodes by re-rendering
            renderVisibleGraph();
            
            // If filtering, restart simulation with ONLY filtered nodes
            if (selectedResourceType !== null) {
                // Stop current simulation
                if (simulation) {
                    simulation.stop();
                }
                
                // Create new simulation with ONLY the filtered nodes
                const filteredNodes = nodes;
                const filteredLinks = links;
                
                if (filteredNodes.length > 0) {
                    // Calculate node sizes for filtered nodes
                    filteredNodes.forEach(node => {
                        const text = node.label;
                        const lines = text.split('\n').length;
                        const maxLineLength = Math.max(...text.split('\n').map(l => l.length));
                        node.width = Math.max(120, maxLineLength * 7 + 30);
                        node.height = Math.max(40, lines * 20 + 20);
                    });
                    
                    simulation = d3.forceSimulation(filteredNodes)
                        .force('link', d3.forceLink(filteredLinks).id(d => d.id).distance(150))
                        .force('charge', d3.forceManyBody().strength(-300))
                        .force('center', d3.forceCenter(width / 2, height / 2))
                        .force('collision', d3.forceCollide().radius(d => Math.max(d.width, d.height) / 2 + 10))
                        .alphaDecay(0.02)
                        .velocityDecay(0.4)
                        .on('tick', () => {
                            renderVisibleGraph();
                        })
                        .on('end', () => {
                            renderVisibleGraph();
                            fitToView();
                        });
                }
            }
            
            // Fit to view after filtering
            setTimeout(() => {
                fitToView();
            }, 100);
        });
        
        tbody.appendChild(row);
    });
    
    table.appendChild(tbody);
    tableContainer.appendChild(table);
}
