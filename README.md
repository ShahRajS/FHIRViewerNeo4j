# FHIR Viewer Neo4j

A modern, interactive web application for visualizing JSON/FHIR data as a Neo4j-style graph using vis.js Network visualization.

## Features

- 📁 **File Upload**: Upload JSON files directly or drag and drop them into the editor
- 📝 **Live JSON Editor**: Edit JSON directly in the left panel with real-time validation
- 🎨 **Neo4j-Style Graph Visualization**: View your JSON structure as a beautiful graph using vis.js Network (Neo4j-compatible)
- 🔍 **Search**: Search for nodes in the visualization (automatically expands to show matches)
- 🔎 **Zoom & Pan**: 
  - Use zoom controls (+/-) to zoom in and out
  - Drag the canvas to pan around
  - Click "Fit to View" to automatically fit the entire graph
  - Drag individual nodes to rearrange them
- 🚀 **Performance Optimizations**:
  - **Depth Limiting**: Control initial tree depth with the "Max Depth" setting
  - **Collapsible Nodes**: Click collapsed nodes (with ▶ indicator) to expand them
  - **Physics Simulation**: Neo4j-style physics engine for smooth graph layout
  - **Auto-optimization**: Automatically adjusts settings for large files
- ✨ **Real-time Updates**: Changes to JSON are reflected in the visualization instantly
- 🎯 **Resource Type Filtering**: Filter visualization by FHIR resource types with color coding
- 🔄 **Drill-down Navigation**: Navigate into specific nodes with back button support

## How to Use

1. **Open the Application**: Open `index.html` in a web browser
2. **Upload JSON**: 
   - Click the "Upload JSON" button to select a JSON file, OR
   - Drag and drop a JSON file into the editor area
3. **Edit JSON**: Type or paste JSON directly into the left panel
4. **Visualize**: Click the "Visualize" button or the visualization will update automatically
5. **Interact with Visualization**:
   - Drag the canvas to pan
   - Use +/- buttons to zoom
   - Click "⊞" to fit to view
   - Drag nodes to rearrange
   - Use the search box to find specific nodes
   - Adjust "Max Depth" to limit how deep the tree is initially shown
   - Click collapsed nodes (showing ▶) to expand and see their children

## Performance Tips for Large Files

For JSON files over 3MB, the app automatically optimizes performance by:
- Reducing the initial depth limit to 2 levels
- Only rendering nodes visible in the viewport
- Throttling updates during pan/zoom operations

**Manual Optimizations:**
- Reduce the "Max Depth" setting to 1-2 for very large files
- Zoom in to specific sections to work with smaller portions of data
- Use search to quickly jump to specific nodes
- Collapse nodes you're not currently viewing to reduce rendering load

## File Structure

```
FHIRViewerNeo4j/
├── index.html    # Main HTML structure
├── style.css     # Styling
├── script.js     # Application logic and Neo4j-style graph visualization
└── README.md     # This file
```

## Technologies Used

- **vis.js Network**: For Neo4j-style graph visualization (compatible with Neo4j graph structures)
- **Vanilla JavaScript**: For all application logic and JSON to graph conversion
- **CSS3**: For modern, responsive styling

## Browser Compatibility

Works best in modern browsers (Chrome, Firefox, Safari, Edge).

## License

MIT License - Feel free to use and modify as needed.
