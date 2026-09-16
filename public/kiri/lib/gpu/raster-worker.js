// src/core/raster-config.js
var config = {};
var device = null;
var deviceCapabilities = null;
var isInitialized = false;
var cachedRasterizePipeline = null;
var cachedRasterizeShaderModule = null;
var cachedToolpathPipeline = null;
var cachedToolpathShaderModule = null;
var cachedRadialBatchPipeline = null;
var cachedRadialBatchShaderModule = null;
var cachedTracingPipeline = null;
var cachedTracingShaderModule = null;
var cachedRadialV3RotatePipeline = null;
var cachedRadialV3RotateShaderModule = null;
var cachedRadialV3BatchedRasterizePipeline = null;
var cachedRadialV3BatchedRasterizeShaderModule = null;
var EMPTY_CELL = -1e10;
var log_pre = "[Worker]";
var diagnostic = false;
var lastlog;
var debug = {
  error: function() {
    console.error(log_pre, ...arguments);
  },
  warn: function() {
    console.warn(log_pre, ...arguments);
  },
  log: function() {
    if (!config.quiet) {
      let now = performance.now();
      let since = (now - (lastlog ?? now) | 0).toString().padStart(4, " ");
      console.log(log_pre, `[${since}]`, ...arguments);
      lastlog = now;
    }
  },
  ok: function() {
    console.log(log_pre, "\u2705", ...arguments);
  }
};
function round(v, d = 1) {
  return parseFloat(v.toFixed(d));
}
var rasterizeShaderCode = `// Planar rasterization with spatial partitioning
// Sentinel value for empty cells (far below any real geometry)
const EMPTY_CELL: f32 = -1e10;

struct Uniforms {
    bounds_min_x: f32,
    bounds_min_y: f32,
    bounds_min_z: f32,
    bounds_max_x: f32,
    bounds_max_y: f32,
    bounds_max_z: f32,
    step_size: f32,
    grid_width: u32,
    grid_height: u32,
    triangle_count: u32,
    filter_mode: u32,  // 0 = UPWARD (terrain, keep highest), 1 = DOWNWARD (tool, keep lowest)
    spatial_grid_width: u32,
    spatial_grid_height: u32,
    spatial_cell_size: f32,
}

@group(0) @binding(0) var<storage, read> triangles: array<f32>;
@group(0) @binding(1) var<storage, read_write> output_points: array<f32>;
@group(0) @binding(2) var<storage, read_write> valid_mask: array<u32>;
@group(0) @binding(3) var<uniform> uniforms: Uniforms;
@group(0) @binding(4) var<storage, read> spatial_cell_offsets: array<u32>;
@group(0) @binding(5) var<storage, read> spatial_triangle_indices: array<u32>;

// Fast 2D bounding box check for XY plane
fn ray_hits_triangle_bbox_2d(ray_x: f32, ray_y: f32, v0: vec3<f32>, v1: vec3<f32>, v2: vec3<f32>) -> bool {
    // Add small epsilon to catch near-misses (mesh vertex gaps, FP rounding)
    let epsilon = 0.001;  // 1 micron tolerance
    let min_x = min(min(v0.x, v1.x), v2.x) - epsilon;
    let max_x = max(max(v0.x, v1.x), v2.x) + epsilon;
    let min_y = min(min(v0.y, v1.y), v2.y) - epsilon;
    let max_y = max(max(v0.y, v1.y), v2.y) + epsilon;

    return ray_x >= min_x && ray_x <= max_x && ray_y >= min_y && ray_y <= max_y;
}

// Ray-triangle intersection using Möller-Trumbore algorithm
fn ray_triangle_intersect(
    ray_origin: vec3<f32>,
    ray_dir: vec3<f32>,
    v0: vec3<f32>,
    v1: vec3<f32>,
    v2: vec3<f32>
) -> vec2<f32> {  // Returns (hit: 0.0 or 1.0, z: intersection_z)
    // Larger epsilon needed because near-parallel triangles (small 'a') amplify errors via f=1/a
    let EPSILON = 0.0001;

    // Early rejection using 2D bounding box (very cheap!)
    if (!ray_hits_triangle_bbox_2d(ray_origin.x, ray_origin.y, v0, v1, v2)) {
        return vec2<f32>(0.0, 0.0);
    }

    // Calculate edges
    let edge1 = v1 - v0;
    let edge2 = v2 - v0;

    // Cross product: ray_dir × edge2
    let h = cross(ray_dir, edge2);

    // Dot product: edge1 · h
    let a = dot(edge1, h);

    if (a > -EPSILON && a < EPSILON) {
        return vec2<f32>(0.0, 0.0); // Ray parallel to triangle
    }

    let f = 1.0 / a;

    // s = ray_origin - v0
    let s = ray_origin - v0;

    // u = f * (s · h)
    let u = f * dot(s, h);

    // Allow tolerance for edges/vertices to ensure watertight coverage
    if (u < -EPSILON || u > 1.0 + EPSILON) {
        return vec2<f32>(0.0, 0.0);
    }

    // Cross product: s × edge1
    let q = cross(s, edge1);

    // v = f * (ray_dir · q)
    let v = f * dot(ray_dir, q);

    // Allow tolerance for edges/vertices to ensure watertight coverage
    if (v < -EPSILON || u + v > 1.0 + EPSILON) {
        return vec2<f32>(0.0, 0.0);
    }

    // t = f * (edge2 · q)
    let t = f * dot(edge2, q);

    if (t > EPSILON) {
        // Intersection found - calculate Z coordinate
        let intersection_z = ray_origin.z + ray_dir.z * t;
        return vec2<f32>(1.0, intersection_z);
    }

    return vec2<f32>(0.0, 0.0);
}

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let grid_x = global_id.x;
    let grid_y = global_id.y;

    if (grid_x >= uniforms.grid_width || grid_y >= uniforms.grid_height) {
        return;
    }

    // Calculate world position for this grid point (center of cell)
    let world_x = uniforms.bounds_min_x + f32(grid_x) * uniforms.step_size;
    let world_y = uniforms.bounds_min_y + f32(grid_y) * uniforms.step_size;

    // Initialize best_z based on filter mode
    var best_z: f32;
    if (uniforms.filter_mode == 0u) {
        best_z = -1e10;  // Terrain: keep highest Z
    } else {
        best_z = 1e10;   // Tool: keep lowest Z
    }

    var found = false;

    // Ray from below mesh pointing up (+Z direction)
    let ray_origin = vec3<f32>(world_x, world_y, uniforms.bounds_min_z - 1.0);
    let ray_dir = vec3<f32>(0.0, 0.0, 1.0);

    // Find which spatial grid cell this ray belongs to
    let spatial_cell_x = u32((world_x - uniforms.bounds_min_x) / uniforms.spatial_cell_size);
    let spatial_cell_y = u32((world_y - uniforms.bounds_min_y) / uniforms.spatial_cell_size);

    // Clamp to spatial grid bounds
    let clamped_cx = min(spatial_cell_x, uniforms.spatial_grid_width - 1u);
    let clamped_cy = min(spatial_cell_y, uniforms.spatial_grid_height - 1u);

    let spatial_cell_idx = clamped_cy * uniforms.spatial_grid_width + clamped_cx;

    // Get triangle range for this cell
    let start_idx = spatial_cell_offsets[spatial_cell_idx];
    let end_idx = spatial_cell_offsets[spatial_cell_idx + 1u];

    // Test only triangles in this spatial cell
    for (var idx = start_idx; idx < end_idx; idx++) {
        let tri_idx = spatial_triangle_indices[idx];
        let tri_base = tri_idx * 9u;

        // Read triangle vertices (already in local space and rotated if needed)
        let v0 = vec3<f32>(
            triangles[tri_base],
            triangles[tri_base + 1u],
            triangles[tri_base + 2u]
        );
        let v1 = vec3<f32>(
            triangles[tri_base + 3u],
            triangles[tri_base + 4u],
            triangles[tri_base + 5u]
        );
        let v2 = vec3<f32>(
            triangles[tri_base + 6u],
            triangles[tri_base + 7u],
            triangles[tri_base + 8u]
        );

        let result = ray_triangle_intersect(ray_origin, ray_dir, v0, v1, v2);
        let hit = result.x;
        let intersection_z = result.y;

        if (hit > 0.5) {
            if (uniforms.filter_mode == 0u) {
                // Terrain: keep highest
                if (intersection_z > best_z) {
                    best_z = intersection_z;
                    found = true;
                }
            } else {
                // Tool: keep lowest
                if (intersection_z < best_z) {
                    best_z = intersection_z;
                    found = true;
                }
            }
        }
    }

    // Write output based on filter mode
    let output_idx = grid_y * uniforms.grid_width + grid_x;

    if (uniforms.filter_mode == 0u) {
        // Terrain: Dense output (Z-only, sentinel value for empty cells)
        if (found) {
            output_points[output_idx] = best_z;
        } else {
            output_points[output_idx] = EMPTY_CELL;
        }
    } else {
        // Tool: Sparse output (X, Y, Z triplets with valid mask)
        output_points[output_idx * 3u] = f32(grid_x);
        output_points[output_idx * 3u + 1u] = f32(grid_y);
        output_points[output_idx * 3u + 2u] = best_z;

        if (found) {
            valid_mask[output_idx] = 1u;
        } else {
            valid_mask[output_idx] = 0u;
        }
    }
}
`;
var toolpathShaderCode = `// Planar toolpath generation
// Sentinel value for empty terrain cells (must match rasterize shader)
const EMPTY_CELL: f32 = -1e10;
const MAX_F32: f32 = 3.402823466e+38;

struct SparseToolPoint {
    x_offset: i32,
    y_offset: i32,
    z_value: f32,
    padding: f32,
}

struct Uniforms {
    terrain_width: u32,
    terrain_height: u32,
    tool_count: u32,
    x_step: u32,
    y_step: u32,
    oob_z: f32,
    points_per_line: u32,
    num_scanlines: u32,
    y_offset: u32,  // Offset to center Y position (for single-scanline radial mode)
}

@group(0) @binding(0) var<storage, read> terrain_map: array<f32>;
@group(0) @binding(1) var<storage, read> sparse_tool: array<SparseToolPoint>;
@group(0) @binding(2) var<storage, read_write> output_path: array<f32>;
@group(0) @binding(3) var<uniform> uniforms: Uniforms;

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let scanline = global_id.y;
    let point_idx = global_id.x;

    if (scanline >= uniforms.num_scanlines || point_idx >= uniforms.points_per_line) {
        return;
    }

    let tool_center_x = i32(point_idx * uniforms.x_step);
    let tool_center_y = i32(scanline * uniforms.y_step) + i32(uniforms.y_offset);

    // var max_collision_z = -MAX_F32;  // Track maximum collision height
    var max_collision_z = uniforms.oob_z;  // Track maximum collision height
    var found_collision = false;

    for (var i = 0u; i < uniforms.tool_count; i++) {
        let tool_point = sparse_tool[i];
        let terrain_x = tool_center_x + tool_point.x_offset;
        let terrain_y = tool_center_y + tool_point.y_offset;

        // Bounds check: X must always be in bounds
        if (terrain_x < 0 || terrain_x >= i32(uniforms.terrain_width)) {
            continue;
        }

        // Bounds check: Y must be within terrain strip bounds
        // For single-scanline OUTPUT mode, the tool center is at Y=0 but the terrain
        // strip contains the full Y range (tool width), so tool offsets access different Y rows
        if (terrain_y < 0 || terrain_y >= i32(uniforms.terrain_height)) {
            continue;
        }

        let terrain_idx = u32(terrain_y) * uniforms.terrain_width + u32(terrain_x);
        let terrain_z = terrain_map[terrain_idx];

        // Check if terrain cell has geometry (not empty sentinel value)
        if (terrain_z > EMPTY_CELL + 1.0) {
            // Tool z_value is positive offset from tip (tip=0, shaft=+50)
            // Subtract from terrain to find where tool center needs to be
            let collision_z = terrain_z + tool_point.z_value;
            max_collision_z = max(max_collision_z, collision_z);
            found_collision = true;
        }
    }

    var output_z = uniforms.oob_z;
    if (found_collision) {
        output_z = max_collision_z;
    }

    let output_idx = scanline * uniforms.points_per_line + point_idx;
    output_path[output_idx] = output_z;
}
`;
var radialRasterizeShaderCode = `// Radial V2 rasterization with X-bucketing and rotating ray planes
// Sentinel value for empty cells (far below any real geometry)
const EMPTY_CELL: f32 = -1e10;
const PI: f32 = 3.14159265359;

struct Uniforms {
    resolution: f32,           // Grid step size (mm)
    angle_step: f32,           // Radians between angles
    num_angles: u32,           // Total number of angular strips
    max_radius: f32,           // Ray origin distance from X-axis (maxHypot * 1.01)
    tool_width: f32,           // Tool width in mm
    grid_y_height: u32,        // Tool width in pixels (toolWidth / resolution)
    bucket_width: f32,         // Width of each X-bucket (mm)
    bucket_grid_width: u32,    // Bucket width in pixels
    global_min_x: f32,         // Global minimum X coordinate
    z_floor: f32,              // Z value for empty cells
    filter_mode: u32,          // 0 = max Z (terrain), 1 = min Z (tool)
    num_buckets: u32,          // Total number of X-buckets
    start_angle: f32,          // Starting angle offset in radians (for batching)
    bucket_offset: u32,        // Offset for bucket batching (bucket_idx in batch writes to bucket_offset + bucket_idx in output)
}

struct BucketInfo {
    min_x: f32,                // Bucket X range start (mm)
    max_x: f32,                // Bucket X range end (mm)
    start_index: u32,          // Index into triangle_indices array
    count: u32                 // Number of triangles in this bucket
}

@group(0) @binding(0) var<storage, read> triangles: array<f32>;
@group(0) @binding(1) var<storage, read_write> output: array<f32>;
@group(0) @binding(2) var<uniform> uniforms: Uniforms;
@group(0) @binding(3) var<storage, read> bucket_info: array<BucketInfo>;
@group(0) @binding(4) var<storage, read> triangle_indices: array<u32>;

// Note: AABB early rejection removed - X-bucketing already provides spatial filtering
// A proper ray-AABB intersection test would be needed if we wanted bounding box culling,
// but checking if ray_origin is inside AABB was incorrect and rejected valid triangles

// Ray-triangle intersection using Möller-Trumbore algorithm
fn ray_triangle_intersect(
    ray_origin: vec3<f32>,
    ray_dir: vec3<f32>,
    v0: vec3<f32>,
    v1: vec3<f32>,
    v2: vec3<f32>
) -> vec2<f32> {  // Returns (hit: 0.0 or 1.0, z: intersection_z)
    let EPSILON = 0.0001;

    // Calculate edges
    let edge1 = v1 - v0;
    let edge2 = v2 - v0;

    // Cross product: ray_dir × edge2
    let h = cross(ray_dir, edge2);

    // Dot product: edge1 · h
    let a = dot(edge1, h);

    if (a > -EPSILON && a < EPSILON) {
        return vec2<f32>(0.0, 0.0); // Ray parallel to triangle
    }

    let f = 1.0 / a;

    // s = ray_origin - v0
    let s = ray_origin - v0;

    // u = f * (s · h)
    let u = f * dot(s, h);

    if (u < -EPSILON || u > 1.0 + EPSILON) {
        return vec2<f32>(0.0, 0.0);
    }

    // Cross product: s × edge1
    let q = cross(s, edge1);

    // v = f * (ray_dir · q)
    let v = f * dot(ray_dir, q);

    if (v < -EPSILON || u + v > 1.0 + EPSILON) {
        return vec2<f32>(0.0, 0.0);
    }

    // t = f * (edge2 · q)
    let t = f * dot(edge2, q);

    if (t > EPSILON) {
        // Intersection found - return distance along ray (t parameter)
        return vec2<f32>(1.0, t);
    }

    return vec2<f32>(0.0, 0.0);
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let bucket_idx = global_id.z;
    let grid_y = global_id.y;
    let angle_idx = global_id.x;

    // Bounds check
    if (angle_idx >= uniforms.num_angles ||
        grid_y >= uniforms.grid_y_height ||
        bucket_idx >= uniforms.num_buckets) {
        return;
    }

    let bucket = bucket_info[bucket_idx];
    let angle = uniforms.start_angle + (f32(angle_idx) * uniforms.angle_step);

    // Calculate bucket min grid X
    let bucket_min_grid_x = u32((bucket.min_x - uniforms.global_min_x) / uniforms.resolution);

    // Loop over X within this bucket
    for (var local_x = 0u; local_x < uniforms.bucket_grid_width; local_x++) {
        let grid_x = bucket_min_grid_x + local_x;
        let world_x = uniforms.global_min_x + f32(grid_x) * uniforms.resolution;

        // Rotating top-down scan: normal XY planar scan, rotated around X-axis
        // Step 1: Define scan position in planar frame (X, Y, Z_above)
        let scan_x = world_x;
        let scan_y = f32(grid_y) * uniforms.resolution - uniforms.tool_width / 2.0;
        let scan_z = uniforms.max_radius;  // Start above the model

        // Step 2: Rotate position (scan_x, scan_y, scan_z) around X-axis by 'angle'
        // X stays the same, rotate YZ plane: y' = y*cos - z*sin, z' = y*sin + z*cos
        // NOTE: This uses right-handed rotation (positive angle rotates +Y towards +Z)
        // To reverse rotation direction (left-handed or opposite), flip signs:
        //   y' = y*cos + z*sin  (flip sign on z term)
        //   z' = -y*sin + z*cos (flip sign on y term)
        let ray_origin_x = scan_x;
        let ray_origin_y = scan_y * cos(angle) - scan_z * sin(angle);
        let ray_origin_z = scan_y * sin(angle) + scan_z * cos(angle);
        let ray_origin = vec3<f32>(ray_origin_x, ray_origin_y, ray_origin_z);

        // Step 3: Rotate ray direction (0, 0, -1) around X-axis by 'angle'
        // X component stays 0, rotate YZ: dy = 0*cos - (-1)*sin = sin, dz = 0*sin + (-1)*cos = -cos
        // NOTE: For reversed rotation, use: vec3<f32>(0.0, -sin(angle), -cos(angle))
        let ray_dir = vec3<f32>(0.0, sin(angle), -cos(angle));

        // Initialize best distance (closest hit)
        var best_t: f32 = 1e10;  // Start with very large distance
        var found = false;

        // Ray-cast against triangles in this bucket
        for (var i = 0u; i < bucket.count; i++) {
            let tri_idx = triangle_indices[bucket.start_index + i];
            let tri_base = tri_idx * 9u;

            // Read triangle vertices
            let v0 = vec3<f32>(
                triangles[tri_base],
                triangles[tri_base + 1u],
                triangles[tri_base + 2u]
            );
            let v1 = vec3<f32>(
                triangles[tri_base + 3u],
                triangles[tri_base + 4u],
                triangles[tri_base + 5u]
            );
            let v2 = vec3<f32>(
                triangles[tri_base + 6u],
                triangles[tri_base + 7u],
                triangles[tri_base + 8u]
            );

            let result = ray_triangle_intersect(ray_origin, ray_dir, v0, v1, v2);
            let hit = result.x;
            let t = result.y;  // Distance along ray

            if (hit > 0.5) {
                // Keep closest hit (minimum t)
                if (t < best_t) {
                    best_t = t;
                    found = true;
                }
            }
        }

        // Write output
        // Layout: (bucket_offset + bucket_idx) * numAngles * bucketWidth * gridHeight
        //       + angle_idx * bucketWidth * gridHeight
        //       + grid_y * bucketWidth
        //       + local_x
        let output_idx = (uniforms.bucket_offset + bucket_idx) * uniforms.num_angles * uniforms.bucket_grid_width * uniforms.grid_y_height
                       + angle_idx * uniforms.bucket_grid_width * uniforms.grid_y_height
                       + grid_y * uniforms.bucket_grid_width
                       + local_x;

        if (found) {
            // Terrain height = distance from scan origin minus ray travel distance
            // Ray started at max_radius from X-axis, traveled best_t distance to hit
            let terrain_height = uniforms.max_radius - best_t;
            output[output_idx] = terrain_height;
        } else {
            output[output_idx] = uniforms.z_floor;
        }
    }
}
`;
var tracingShaderCode = `// Tracing toolpath generation
// Follows input polylines and calculates Z-depth at each sampled point
// Sentinel value for empty terrain cells (must match rasterize shader)
const EMPTY_CELL: f32 = -1e10;
const MAX_F32: f32 = 3.402823466e+38;

struct SparseToolPoint {
    x_offset: i32,
    y_offset: i32,
    z_value: f32,
    padding: f32,
}

struct Uniforms {
    terrain_width: u32,
    terrain_height: u32,
    tool_count: u32,
    point_count: u32,        // Number of sampled points to process
    path_index: u32,         // Index of current path being processed
    terrain_min_x: f32,      // Terrain bounding box (world coordinates)
    terrain_min_y: f32,
    grid_step: f32,          // Resolution of terrain rasterization
    oob_z: f32,              // Z value for out-of-bounds points (zFloor)
}

@group(0) @binding(0) var<storage, read> terrain_map: array<f32>;
@group(0) @binding(1) var<storage, read> sparse_tool: array<SparseToolPoint>;
@group(0) @binding(2) var<storage, read> input_points: array<f32>;  // XY pairs
@group(0) @binding(3) var<storage, read_write> output_depths: array<f32>;  // Z values
@group(0) @binding(4) var<storage, read_write> max_z_buffer: array<atomic<i32>>;  // Max Z per path (as bits)
@group(0) @binding(5) var<uniform> uniforms: Uniforms;

@compute @workgroup_size(64, 1, 1)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let point_idx = global_id.x;

    if (point_idx >= uniforms.point_count) {
        return;
    }

    // Read input X,Y world coordinates
    let world_x = input_points[point_idx * 2u + 0u];
    let world_y = input_points[point_idx * 2u + 1u];

    // Convert world coordinates to grid coordinates
    let grid_x_f32 = (world_x - uniforms.terrain_min_x) / uniforms.grid_step;
    let grid_y_f32 = (world_y - uniforms.terrain_min_y) / uniforms.grid_step;
    let tool_center_x = i32(grid_x_f32);
    let tool_center_y = i32(grid_y_f32);

    // Check if tool center is outside terrain bounds
    let center_oob = tool_center_x < 0 || tool_center_x >= i32(uniforms.terrain_width) ||
                     tool_center_y < 0 || tool_center_y >= i32(uniforms.terrain_height);

    var max_collision_z = uniforms.oob_z;
    var found_collision = false;

    // Test each tool point for collision with terrain
    for (var i = 0u; i < uniforms.tool_count; i++) {
        let tool_point = sparse_tool[i];
        let terrain_x = tool_center_x + tool_point.x_offset;
        let terrain_y = tool_center_y + tool_point.y_offset;

        // Bounds check: terrain sample must be within terrain grid
        if (terrain_x < 0 || terrain_x >= i32(uniforms.terrain_width) ||
            terrain_y < 0 || terrain_y >= i32(uniforms.terrain_height)) {
            continue;
        }

        let terrain_idx = u32(terrain_y) * uniforms.terrain_width + u32(terrain_x);
        let terrain_z = terrain_map[terrain_idx];

        // Check if terrain cell has geometry (not empty sentinel value)
        if (terrain_z > EMPTY_CELL + 1.0) {
            // Tool z_value is positive offset from tip (tip=0, shaft=+50)
            // Add to terrain height to find where tool center needs to be
            let collision_z = terrain_z + tool_point.z_value;
            max_collision_z = max(max_collision_z, collision_z);
            found_collision = true;
        }
    }

    // If no collision found and center was in-bounds, use oob_z
    var output_z = uniforms.oob_z;
    if (found_collision) {
        output_z = max_collision_z;
    }

    output_depths[point_idx] = output_z;

    // Update max Z for this path using atomic operation
    // Convert float to int bits for atomic comparison
    let z_bits = bitcast<i32>(output_z);
    atomicMax(&max_z_buffer[uniforms.path_index], z_bits);
}
`;
var radialV3RotateShaderCode = `// Triangle rotation shader for radial rasterization V3
// Rotates all triangles in a bucket by a single angle and computes Y-bounds

struct Uniforms {
    angle: f32,              // Rotation angle in radians
    num_triangles: u32,      // Number of triangles to rotate
}

struct RotatedTriangle {
    v0: vec3<f32>,          // Rotated vertex 0
    v1: vec3<f32>,          // Rotated vertex 1
    v2: vec3<f32>,          // Rotated vertex 2
    y_min: f32,             // Minimum Y coordinate (for filtering)
    y_max: f32,             // Maximum Y coordinate (for filtering)
}

@group(0) @binding(0) var<storage, read> triangles: array<f32>;           // Input: original triangles (flat array)
@group(0) @binding(1) var<storage, read_write> rotated: array<f32>;       // Output: rotated triangles + bounds
@group(0) @binding(2) var<uniform> uniforms: Uniforms;

// Rotate a point around X-axis
fn rotate_around_x(p: vec3<f32>, angle: f32) -> vec3<f32> {
    let cos_a = cos(angle);
    let sin_a = sin(angle);

    return vec3<f32>(
        p.x,
        p.y * cos_a - p.z * sin_a,
        p.y * sin_a + p.z * cos_a
    );
}

@compute @workgroup_size(64, 1, 1)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let tri_idx = global_id.x;

    if (tri_idx >= uniforms.num_triangles) {
        return;
    }

    // Read original triangle vertices
    let base = tri_idx * 9u;
    let v0 = vec3<f32>(triangles[base], triangles[base + 1u], triangles[base + 2u]);
    let v1 = vec3<f32>(triangles[base + 3u], triangles[base + 4u], triangles[base + 5u]);
    let v2 = vec3<f32>(triangles[base + 6u], triangles[base + 7u], triangles[base + 8u]);

    // Rotate vertices around X-axis
    let v0_rot = rotate_around_x(v0, uniforms.angle);
    let v1_rot = rotate_around_x(v1, uniforms.angle);
    let v2_rot = rotate_around_x(v2, uniforms.angle);

    // Compute Y bounds for fast filtering during rasterization
    let y_min = min(v0_rot.y, min(v1_rot.y, v2_rot.y));
    let y_max = max(v0_rot.y, max(v1_rot.y, v2_rot.y));

    // Write rotated triangle + bounds
    // Layout: 11 floats per triangle: v0(3), v1(3), v2(3), y_min(1), y_max(1)
    let out_base = tri_idx * 11u;
    rotated[out_base] = v0_rot.x;
    rotated[out_base + 1u] = v0_rot.y;
    rotated[out_base + 2u] = v0_rot.z;
    rotated[out_base + 3u] = v1_rot.x;
    rotated[out_base + 4u] = v1_rot.y;
    rotated[out_base + 5u] = v1_rot.z;
    rotated[out_base + 6u] = v2_rot.x;
    rotated[out_base + 7u] = v2_rot.y;
    rotated[out_base + 8u] = v2_rot.z;
    rotated[out_base + 9u] = y_min;
    rotated[out_base + 10u] = y_max;
}
`;
var radialV3BatchedRasterizeShaderCode = `// Radial V3 batched bucket rasterization
// Processes ALL buckets in one dispatch - GPU threads find their bucket

const EPSILON: f32 = 0.0001;

struct Uniforms {
    resolution: f32,         // Grid step size (mm)
    tool_radius: f32,        // Tool radius for Y-filtering
    full_grid_width: u32,    // Full grid width (all buckets)
    grid_height: u32,        // Number of Y cells
    global_min_x: f32,       // Global minimum X coordinate
    bucket_min_y: f32,       // Y-axis start (typically -tool_width/2)
    z_floor: f32,            // Z value for empty cells
    num_buckets: u32,        // Number of buckets
}

struct BucketInfo {
    min_x: f32,              // Bucket X range start
    max_x: f32,              // Bucket X range end
    start_index: u32,        // Index into triangle_indices array
    count: u32,              // Number of triangles in this bucket
}

@group(0) @binding(0) var<storage, read> rotated_triangles: array<f32>;   // ALL rotated triangles + bounds
@group(0) @binding(1) var<storage, read_write> output: array<f32>;        // Full-width output grid
@group(0) @binding(2) var<uniform> uniforms: Uniforms;
@group(0) @binding(3) var<storage, read> all_buckets: array<BucketInfo>;  // All bucket descriptors
@group(0) @binding(4) var<storage, read> triangle_indices: array<u32>;    // All triangle indices

// Simplified ray-triangle intersection for downward rays
fn ray_triangle_intersect_downward(
    ray_origin: vec3<f32>,
    v0: vec3<f32>,
    v1: vec3<f32>,
    v2: vec3<f32>
) -> vec2<f32> {  // Returns (hit: 0.0 or 1.0, t: distance along ray)
    let ray_dir = vec3<f32>(0.0, 0.0, -1.0);

    let edge1 = v1 - v0;
    let edge2 = v2 - v0;
    let h = cross(ray_dir, edge2);
    let a = dot(edge1, h);

    if (a > -EPSILON && a < EPSILON) {
        return vec2<f32>(0.0, 0.0);
    }

    let f = 1.0 / a;
    let s = ray_origin - v0;
    let u = f * dot(s, h);

    if (u < -EPSILON || u > 1.0 + EPSILON) {
        return vec2<f32>(0.0, 0.0);
    }

    let q = cross(s, edge1);
    let v = f * dot(ray_dir, q);

    if (v < -EPSILON || u + v > 1.0 + EPSILON) {
        return vec2<f32>(0.0, 0.0);
    }

    let t = f * dot(edge2, q);

    if (t > EPSILON) {
        return vec2<f32>(1.0, t);
    }

    return vec2<f32>(0.0, 0.0);
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let grid_x = global_id.x;
    let grid_y = global_id.y;

    // Bounds check
    if (grid_x >= uniforms.full_grid_width || grid_y >= uniforms.grid_height) {
        return;
    }

    // Calculate world position
    let world_x = uniforms.global_min_x + f32(grid_x) * uniforms.resolution;
    let world_y = uniforms.bucket_min_y + f32(grid_y) * uniforms.resolution;

    // FIND WHICH BUCKET THIS X POSITION BELONGS TO
    // Simple linear search (could be binary search for many buckets)
    var bucket_idx = 0u;
    var found_bucket = false;
    for (var i = 0u; i < uniforms.num_buckets; i++) {
        if (world_x >= all_buckets[i].min_x && world_x < all_buckets[i].max_x) {
            bucket_idx = i;
            found_bucket = true;
            break;
        }
    }

    // If not in any bucket, write floor and return
    if (!found_bucket) {
        let output_idx = grid_y * uniforms.full_grid_width + grid_x;
        output[output_idx] = uniforms.z_floor;
        return;
    }

    let bucket = all_buckets[bucket_idx];

    // Fixed downward ray from high above
    let ray_origin = vec3<f32>(world_x, world_y, 1000.0);

    // Track best (closest) hit
    var best_z = uniforms.z_floor;

    // Test triangles in this bucket with Y-bounds filtering
    for (var i = 0u; i < bucket.count; i++) {
        // Get triangle index from bucket's index array
        let tri_idx = triangle_indices[bucket.start_index + i];

        // Read Y-bounds first (cheaper than reading all vertices)
        let base = tri_idx * 11u;
        let y_min = rotated_triangles[base + 9u];
        let y_max = rotated_triangles[base + 10u];

        // Y-bounds check: skip triangles that don't overlap this ray's Y position
        if (y_max < world_y - uniforms.tool_radius ||
            y_min > world_y + uniforms.tool_radius) {
            continue;
        }

        // Read rotated vertices
        let v0 = vec3<f32>(
            rotated_triangles[base],
            rotated_triangles[base + 1u],
            rotated_triangles[base + 2u]
        );
        let v1 = vec3<f32>(
            rotated_triangles[base + 3u],
            rotated_triangles[base + 4u],
            rotated_triangles[base + 5u]
        );
        let v2 = vec3<f32>(
            rotated_triangles[base + 6u],
            rotated_triangles[base + 7u],
            rotated_triangles[base + 8u]
        );

        let result = ray_triangle_intersect_downward(ray_origin, v0, v1, v2);
        let hit = result.x;
        let t = result.y;

        if (hit > 0.5) {
            // Calculate Z position of intersection
            let hit_z = ray_origin.z - t;

            // Keep highest (max Z) hit
            if (hit_z > best_z) {
                best_z = hit_z;
            }
        }
    }

    // Write to FULL-WIDTH output (no stitching needed!)
    let output_idx = grid_y * uniforms.full_grid_width + grid_x;
    output[output_idx] = best_z;
}
`;
async function initWebGPU() {
  if (isInitialized) return true;
  if (!navigator.gpu) {
    debug.warn("WebGPU not supported");
    return false;
  }
  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      debug.warn("WebGPU adapter not available");
      return false;
    }
    const adapterLimits = adapter.limits;
    debug.log("Adapter limits:", adapterLimits);
    device = await adapter.requestDevice({
      requiredLimits: {
        maxStorageBufferBindingSize: Math.min(
          adapterLimits.maxStorageBufferBindingSize,
          1024 * 1024 * 1024
          // Request up to 1GB
        ),
        maxBufferSize: Math.min(
          adapterLimits.maxBufferSize,
          1024 * 1024 * 1024
          // Request up to 1GB
        )
      }
    });
    cachedRasterizeShaderModule = device.createShaderModule({ code: rasterizeShaderCode });
    cachedRasterizePipeline = device.createComputePipeline({
      layout: "auto",
      compute: { module: cachedRasterizeShaderModule, entryPoint: "main" }
    });
    cachedToolpathShaderModule = device.createShaderModule({ code: toolpathShaderCode });
    cachedToolpathPipeline = device.createComputePipeline({
      layout: "auto",
      compute: { module: cachedToolpathShaderModule, entryPoint: "main" }
    });
    cachedRadialBatchShaderModule = device.createShaderModule({ code: radialRasterizeShaderCode });
    cachedRadialBatchPipeline = device.createComputePipeline({
      layout: "auto",
      compute: { module: cachedRadialBatchShaderModule, entryPoint: "main" }
    });
    cachedTracingShaderModule = device.createShaderModule({ code: tracingShaderCode });
    cachedTracingPipeline = device.createComputePipeline({
      layout: "auto",
      compute: { module: cachedTracingShaderModule, entryPoint: "main" }
    });
    cachedRadialV3RotateShaderModule = device.createShaderModule({ code: radialV3RotateShaderCode });
    cachedRadialV3RotatePipeline = device.createComputePipeline({
      layout: "auto",
      compute: { module: cachedRadialV3RotateShaderModule, entryPoint: "main" }
    });
    cachedRadialV3BatchedRasterizeShaderModule = device.createShaderModule({ code: radialV3BatchedRasterizeShaderCode });
    cachedRadialV3BatchedRasterizePipeline = device.createComputePipeline({
      layout: "auto",
      compute: { module: cachedRadialV3BatchedRasterizeShaderModule, entryPoint: "main" }
    });
    deviceCapabilities = {
      maxStorageBufferBindingSize: device.limits.maxStorageBufferBindingSize,
      maxBufferSize: device.limits.maxBufferSize,
      maxComputeWorkgroupSizeX: device.limits.maxComputeWorkgroupSizeX,
      maxComputeWorkgroupSizeY: device.limits.maxComputeWorkgroupSizeY
    };
    isInitialized = true;
    debug.log("Initialized (pipelines cached)");
    return true;
  } catch (error) {
    debug.error("Failed to initialize:", error);
    return false;
  }
}
function setConfig(newConfig) {
  config = newConfig;
}
function updateConfig(updates) {
  Object.assign(config, updates);
}

// src/core/raster-planar.js
function calculateBounds(triangles) {
  let min_x = Infinity, min_y = Infinity, min_z = Infinity;
  let max_x = -Infinity, max_y = -Infinity, max_z = -Infinity;
  for (let i = 0; i < triangles.length; i += 3) {
    const x = triangles[i];
    const y = triangles[i + 1];
    const z = triangles[i + 2];
    if (x < min_x) min_x = x;
    if (y < min_y) min_y = y;
    if (z < min_z) min_z = z;
    if (x > max_x) max_x = x;
    if (y > max_y) max_y = y;
    if (z > max_z) max_z = z;
  }
  return {
    min: { x: min_x, y: min_y, z: min_z },
    max: { x: max_x, y: max_y, z: max_z }
  };
}
function buildSpatialGrid(triangles, bounds, cellSize = 5) {
  const gridWidth = Math.max(1, Math.ceil((bounds.max.x - bounds.min.x) / cellSize));
  const gridHeight = Math.max(1, Math.ceil((bounds.max.y - bounds.min.y) / cellSize));
  const totalCells = gridWidth * gridHeight;
  const grid = new Array(totalCells);
  for (let i = 0; i < totalCells; i++) {
    grid[i] = [];
  }
  const triangleCount = triangles.length / 9;
  for (let t = 0; t < triangleCount; t++) {
    const base = t * 9;
    const v0x = triangles[base], v0y = triangles[base + 1];
    const v1x = triangles[base + 3], v1y = triangles[base + 4];
    const v2x = triangles[base + 6], v2y = triangles[base + 7];
    const epsilon = cellSize * 0.01;
    const minX = Math.min(v0x, v1x, v2x) - epsilon;
    const maxX = Math.max(v0x, v1x, v2x) + epsilon;
    const minY = Math.min(v0y, v1y, v2y) - epsilon;
    const maxY = Math.max(v0y, v1y, v2y) + epsilon;
    let minCellX = Math.floor((minX - bounds.min.x) / cellSize);
    let maxCellX = Math.floor((maxX - bounds.min.x) / cellSize);
    let minCellY = Math.floor((minY - bounds.min.y) / cellSize);
    let maxCellY = Math.floor((maxY - bounds.min.y) / cellSize);
    minCellX = Math.max(0, Math.min(gridWidth - 1, minCellX));
    maxCellX = Math.max(0, Math.min(gridWidth - 1, maxCellX));
    minCellY = Math.max(0, Math.min(gridHeight - 1, minCellY));
    maxCellY = Math.max(0, Math.min(gridHeight - 1, maxCellY));
    for (let cy = minCellY; cy <= maxCellY; cy++) {
      for (let cx = minCellX; cx <= maxCellX; cx++) {
        const cellIdx = cy * gridWidth + cx;
        grid[cellIdx].push(t);
      }
    }
  }
  let totalTriangleRefs = 0;
  for (let i = 0; i < totalCells; i++) {
    totalTriangleRefs += grid[i].length;
  }
  const cellOffsets = new Uint32Array(totalCells + 1);
  const triangleIndices = new Uint32Array(totalTriangleRefs);
  let currentOffset = 0;
  for (let i = 0; i < totalCells; i++) {
    cellOffsets[i] = currentOffset;
    for (let j = 0; j < grid[i].length; j++) {
      triangleIndices[currentOffset++] = grid[i][j];
    }
  }
  cellOffsets[totalCells] = currentOffset;
  const avgPerCell = totalTriangleRefs / totalCells;
  const toolWidth = bounds.max.x - bounds.min.x;
  const toolHeight = bounds.max.y - bounds.min.y;
  const toolDiameter = Math.max(toolWidth, toolHeight);
  debug.log(`Spatial grid: ${gridWidth}x${gridHeight} ${totalTriangleRefs} tri-refs ~${avgPerCell.toFixed(0)}/${cellSize}mm cell (tool: ${toolDiameter.toFixed(2)}mm)`);
  return {
    gridWidth,
    gridHeight,
    cellSize,
    cellOffsets,
    triangleIndices,
    avgTrianglesPerCell: avgPerCell
  };
}
async function rasterizeMeshSingle(triangles, stepSize, filterMode, options = {}) {
  const startTime = performance.now();
  if (!isInitialized) {
    const initStart = performance.now();
    const success = await initWebGPU();
    if (!success) {
      throw new Error("WebGPU not available");
    }
    const initEnd = performance.now();
    debug.log(`First-time init: ${(initEnd - initStart).toFixed(1)}ms`);
  }
  const boundsOverride = options.bounds || options.min ? options : null;
  const bounds = boundsOverride || calculateBounds(triangles);
  if (boundsOverride) {
    if (bounds.min.x >= bounds.max.x || bounds.min.y >= bounds.max.y || bounds.min.z >= bounds.max.z) {
      throw new Error(`Invalid bounds: min must be less than max. Got min(${bounds.min.x}, ${bounds.min.y}, ${bounds.min.z}) max(${bounds.max.x}, ${bounds.max.y}, ${bounds.max.z})`);
    }
  }
  const gridWidth = Math.ceil((bounds.max.x - bounds.min.x) / stepSize) + 1;
  const gridHeight = Math.ceil((bounds.max.y - bounds.min.y) / stepSize) + 1;
  const totalGridPoints = gridWidth * gridHeight;
  const floatsPerPoint = filterMode === 0 ? 1 : 3;
  const outputSize = totalGridPoints * floatsPerPoint * 4;
  const maxBufferSize = device.limits.maxBufferSize || 268435456;
  if (outputSize > maxBufferSize) {
    throw new Error(`Output buffer too large: ${(outputSize / 1024 / 1024).toFixed(2)} MB exceeds device limit of ${(maxBufferSize / 1024 / 1024).toFixed(2)} MB. Try a larger step size.`);
  }
  console.time(`${log_pre} Build Spatial Grid`);
  const spatialGrid = buildSpatialGrid(triangles, bounds);
  console.timeEnd(`${log_pre} Build Spatial Grid`);
  const triangleBuffer = device.createBuffer({
    size: triangles.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
  });
  device.queue.writeBuffer(triangleBuffer, 0, triangles);
  const outputBuffer = device.createBuffer({
    size: outputSize,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST
  });
  if (filterMode === 0) {
    const initData = new Float32Array(totalGridPoints);
    initData.fill(EMPTY_CELL);
    device.queue.writeBuffer(outputBuffer, 0, initData);
  }
  const validMaskBuffer = device.createBuffer({
    size: totalGridPoints * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
  });
  const spatialCellOffsetsBuffer = device.createBuffer({
    size: spatialGrid.cellOffsets.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
  });
  device.queue.writeBuffer(spatialCellOffsetsBuffer, 0, spatialGrid.cellOffsets);
  const spatialTriangleIndicesBuffer = device.createBuffer({
    size: spatialGrid.triangleIndices.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
  });
  device.queue.writeBuffer(spatialTriangleIndicesBuffer, 0, spatialGrid.triangleIndices);
  const uniformData = new Float32Array([
    bounds.min.x,
    bounds.min.y,
    bounds.min.z,
    bounds.max.x,
    bounds.max.y,
    bounds.max.z,
    stepSize,
    0,
    0,
    0,
    0,
    0,
    0,
    0
    // Padding for alignment
  ]);
  const uniformDataU32 = new Uint32Array(uniformData.buffer);
  uniformDataU32[7] = gridWidth;
  uniformDataU32[8] = gridHeight;
  uniformDataU32[9] = triangles.length / 9;
  uniformDataU32[10] = filterMode;
  uniformDataU32[11] = spatialGrid.gridWidth;
  uniformDataU32[12] = spatialGrid.gridHeight;
  const uniformDataF32 = new Float32Array(uniformData.buffer);
  uniformDataF32[13] = spatialGrid.cellSize;
  const maxU32 = 4294967295;
  if (gridWidth > maxU32 || gridHeight > maxU32) {
    throw new Error(`Grid dimensions exceed u32 max: ${gridWidth}x${gridHeight}`);
  }
  const uniformBuffer = device.createBuffer({
    size: uniformData.byteLength,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
  });
  device.queue.writeBuffer(uniformBuffer, 0, uniformData);
  await device.queue.onSubmittedWorkDone();
  const bindGroup = device.createBindGroup({
    layout: cachedRasterizePipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: triangleBuffer } },
      { binding: 1, resource: { buffer: outputBuffer } },
      { binding: 2, resource: { buffer: validMaskBuffer } },
      { binding: 3, resource: { buffer: uniformBuffer } },
      { binding: 4, resource: { buffer: spatialCellOffsetsBuffer } },
      { binding: 5, resource: { buffer: spatialTriangleIndicesBuffer } }
    ]
  });
  const commandEncoder = device.createCommandEncoder();
  const passEncoder = commandEncoder.beginComputePass();
  passEncoder.setPipeline(cachedRasterizePipeline);
  passEncoder.setBindGroup(0, bindGroup);
  const workgroupsX = Math.ceil(gridWidth / 16);
  const workgroupsY = Math.ceil(gridHeight / 16);
  const maxWorkgroupsPerDim = device.limits.maxComputeWorkgroupsPerDimension || 65535;
  if (workgroupsX > maxWorkgroupsPerDim || workgroupsY > maxWorkgroupsPerDim) {
    throw new Error(`Workgroup dispatch too large: ${workgroupsX}x${workgroupsY} exceeds limit of ${maxWorkgroupsPerDim}. Try a larger step size.`);
  }
  passEncoder.dispatchWorkgroups(workgroupsX, workgroupsY);
  passEncoder.end();
  const stagingOutputBuffer = device.createBuffer({
    size: outputSize,
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST
  });
  const stagingValidMaskBuffer = device.createBuffer({
    size: totalGridPoints * 4,
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST
  });
  commandEncoder.copyBufferToBuffer(outputBuffer, 0, stagingOutputBuffer, 0, outputSize);
  commandEncoder.copyBufferToBuffer(validMaskBuffer, 0, stagingValidMaskBuffer, 0, totalGridPoints * 4);
  device.queue.submit([commandEncoder.finish()]);
  await device.queue.onSubmittedWorkDone();
  await stagingOutputBuffer.mapAsync(GPUMapMode.READ);
  await stagingValidMaskBuffer.mapAsync(GPUMapMode.READ);
  const outputData = new Float32Array(stagingOutputBuffer.getMappedRange());
  const validMaskData = new Uint32Array(stagingValidMaskBuffer.getMappedRange());
  let result, pointCount;
  if (filterMode === 0) {
    result = new Float32Array(outputData);
    pointCount = totalGridPoints;
    if (config.debug) {
      let zeroCount = 0;
      let validCount = 0;
      for (let i = 0; i < totalGridPoints; i++) {
        if (result[i] > EMPTY_CELL + 1) validCount++;
        if (result[i] === 0) zeroCount++;
      }
      let percentHit = validCount / totalGridPoints;
      if (zeroCount > 0 || percentHit < 0.5) {
        debug.log(totalGridPoints, "cells,", round(percentHit * 100), "% coverage,", zeroCount, "zeros");
      }
    }
  } else {
    const validPoints = [];
    for (let i = 0; i < totalGridPoints; i++) {
      if (validMaskData[i] === 1) {
        validPoints.push(
          outputData[i * 3],
          outputData[i * 3 + 1],
          outputData[i * 3 + 2]
        );
      }
    }
    result = new Float32Array(validPoints);
    pointCount = validPoints.length / 3;
  }
  stagingOutputBuffer.unmap();
  stagingValidMaskBuffer.unmap();
  triangleBuffer.destroy();
  outputBuffer.destroy();
  validMaskBuffer.destroy();
  uniformBuffer.destroy();
  spatialCellOffsetsBuffer.destroy();
  spatialTriangleIndicesBuffer.destroy();
  stagingOutputBuffer.destroy();
  stagingValidMaskBuffer.destroy();
  const endTime = performance.now();
  const conversionTime = endTime - startTime;
  if (filterMode === 0) {
    if (result.length > 0) {
      const firstZ = result[0] <= EMPTY_CELL + 1 ? "EMPTY" : result[0].toFixed(3);
      const lastZ = result[result.length - 1] <= EMPTY_CELL + 1 ? "EMPTY" : result[result.length - 1].toFixed(3);
    }
  } else {
    if (result.length > 0) {
      const firstPoint = `(${result[0].toFixed(3)}, ${result[1].toFixed(3)}, ${result[2].toFixed(3)})`;
      const lastIdx = result.length - 3;
      const lastPoint = `(${result[lastIdx].toFixed(3)}, ${result[lastIdx + 1].toFixed(3)}, ${result[lastIdx + 2].toFixed(3)})`;
    }
  }
  return {
    positions: result,
    pointCount,
    bounds,
    conversionTime,
    gridWidth,
    gridHeight,
    isDense: filterMode === 0
    // True for terrain (dense), false for tool (sparse)
  };
}
function createTiles(bounds, stepSize, maxMemoryBytes) {
  const width = bounds.max.x - bounds.min.x;
  const height = bounds.max.y - bounds.min.y;
  const aspectRatio = width / height;
  const bytesPerPoint = 1 * 4;
  const maxPointsPerTile = Math.floor(maxMemoryBytes / bytesPerPoint);
  debug.log(`Dense terrain format: ${bytesPerPoint} bytes/point (was 16), can fit ${(maxPointsPerTile / 1e6).toFixed(1)}M points per tile`);
  let tileGridW, tileGridH;
  if (aspectRatio >= 1) {
    tileGridH = Math.floor(Math.sqrt(maxPointsPerTile / aspectRatio));
    tileGridW = Math.floor(tileGridH * aspectRatio);
  } else {
    tileGridW = Math.floor(Math.sqrt(maxPointsPerTile * aspectRatio));
    tileGridH = Math.floor(tileGridW / aspectRatio);
  }
  while (tileGridW * tileGridH * bytesPerPoint > maxMemoryBytes) {
    if (tileGridW > tileGridH) {
      tileGridW--;
    } else {
      tileGridH--;
    }
  }
  const tileWidth = tileGridW * stepSize;
  const tileHeight = tileGridH * stepSize;
  const tilesX = Math.ceil(width / tileWidth);
  const tilesY = Math.ceil(height / tileHeight);
  const actualTileWidth = width / tilesX;
  const actualTileHeight = height / tilesY;
  debug.log(`Creating ${tilesX}x${tilesY} = ${tilesX * tilesY} tiles (${actualTileWidth.toFixed(2)}mm \xD7 ${actualTileHeight.toFixed(2)}mm each)`);
  debug.log(`Tile grid: ${Math.ceil(actualTileWidth / stepSize)}x${Math.ceil(actualTileHeight / stepSize)} points per tile`);
  const tiles = [];
  const overlap = stepSize * 2;
  for (let ty = 0; ty < tilesY; ty++) {
    for (let tx = 0; tx < tilesX; tx++) {
      let tileMinX = bounds.min.x + tx * actualTileWidth;
      let tileMinY = bounds.min.y + ty * actualTileHeight;
      let tileMaxX = Math.min(bounds.max.x, tileMinX + actualTileWidth);
      let tileMaxY = Math.min(bounds.max.y, tileMinY + actualTileHeight);
      if (tx > 0) tileMinX = Math.max(bounds.min.x, tileMinX - overlap);
      if (ty > 0) tileMinY = Math.max(bounds.min.y, tileMinY - overlap);
      if (tx < tilesX - 1) tileMaxX = Math.min(bounds.max.x, tileMaxX + overlap);
      if (ty < tilesY - 1) tileMaxY = Math.min(bounds.max.y, tileMaxY + overlap);
      tiles.push({
        id: `tile_${tx}_${ty}`,
        bounds: {
          min: { x: tileMinX, y: tileMinY, z: bounds.min.z },
          max: { x: tileMaxX, y: tileMaxY, z: bounds.max.z }
        }
      });
    }
  }
  return { tiles, tilesX, tilesY };
}
function stitchTiles(tileResults, fullBounds, stepSize) {
  if (tileResults.length === 0) {
    throw new Error("No tile results to stitch");
  }
  const isDense = tileResults[0].isDense;
  if (isDense) {
    debug.log(`Stitching ${tileResults.length} dense terrain tiles...`);
    const globalWidth = Math.ceil((fullBounds.max.x - fullBounds.min.x) / stepSize) + 1;
    const globalHeight = Math.ceil((fullBounds.max.y - fullBounds.min.y) / stepSize) + 1;
    const totalGridCells = globalWidth * globalHeight;
    const globalGrid = new Float32Array(totalGridCells);
    globalGrid.fill(EMPTY_CELL);
    debug.log(`Global grid: ${globalWidth}x${globalHeight} = ${totalGridCells.toLocaleString()} cells`);
    for (const tile of tileResults) {
      const tileOffsetX = Math.round((tile.tileBounds.min.x - fullBounds.min.x) / stepSize);
      const tileOffsetY = Math.round((tile.tileBounds.min.y - fullBounds.min.y) / stepSize);
      const tileWidth = tile.gridWidth;
      const tileHeight = tile.gridHeight;
      for (let ty = 0; ty < tileHeight; ty++) {
        const globalY = tileOffsetY + ty;
        if (globalY >= globalHeight) continue;
        for (let tx = 0; tx < tileWidth; tx++) {
          const globalX = tileOffsetX + tx;
          if (globalX >= globalWidth) continue;
          const tileIdx = ty * tileWidth + tx;
          const globalIdx = globalY * globalWidth + globalX;
          const tileZ = tile.positions[tileIdx];
          if (tileZ > EMPTY_CELL + 1) {
            const existingZ = globalGrid[globalIdx];
            if (existingZ <= EMPTY_CELL + 1 || tileZ > existingZ) {
              globalGrid[globalIdx] = tileZ;
            }
          }
        }
      }
    }
    let validCount = 0;
    for (let i = 0; i < totalGridCells; i++) {
      if (globalGrid[i] > EMPTY_CELL + 1) validCount++;
    }
    debug.log(`Stitched: ${totalGridCells} total cells, ${validCount} with geometry (${(validCount / totalGridCells * 100).toFixed(1)}% coverage)`);
    return {
      positions: globalGrid,
      pointCount: totalGridCells,
      bounds: fullBounds,
      gridWidth: globalWidth,
      gridHeight: globalHeight,
      isDense: true,
      conversionTime: tileResults.reduce((sum, r) => sum + (r.conversionTime || 0), 0),
      tileCount: tileResults.length
    };
  } else {
    debug.log(`Stitching ${tileResults.length} sparse tool tiles...`);
    const pointMap = /* @__PURE__ */ new Map();
    for (const result of tileResults) {
      const positions = result.positions;
      const tileOffsetX = Math.round((result.tileBounds.min.x - fullBounds.min.x) / stepSize);
      const tileOffsetY = Math.round((result.tileBounds.min.y - fullBounds.min.y) / stepSize);
      for (let i = 0; i < positions.length; i += 3) {
        const localGridX = positions[i];
        const localGridY = positions[i + 1];
        const z = positions[i + 2];
        const globalGridX = localGridX + tileOffsetX;
        const globalGridY = localGridY + tileOffsetY;
        const key = `${globalGridX},${globalGridY}`;
        const existing = pointMap.get(key);
        if (!existing || z < existing.z) {
          pointMap.set(key, { x: globalGridX, y: globalGridY, z });
        }
      }
    }
    const finalPointCount = pointMap.size;
    const allPositions = new Float32Array(finalPointCount * 3);
    let writeOffset = 0;
    for (const point of pointMap.values()) {
      allPositions[writeOffset++] = point.x;
      allPositions[writeOffset++] = point.y;
      allPositions[writeOffset++] = point.z;
    }
    debug.log(`Stitched: ${finalPointCount} unique sparse points`);
    return {
      positions: allPositions,
      pointCount: finalPointCount,
      bounds: fullBounds,
      isDense: false,
      conversionTime: tileResults.reduce((sum, r) => sum + (r.conversionTime || 0), 0),
      tileCount: tileResults.length
    };
  }
}
function shouldUseTiling(bounds, stepSize) {
  if (!config || !config.autoTiling) return false;
  if (!deviceCapabilities) return false;
  const gridWidth = Math.ceil((bounds.max.x - bounds.min.x) / stepSize) + 1;
  const gridHeight = Math.ceil((bounds.max.y - bounds.min.y) / stepSize) + 1;
  const totalPoints = gridWidth * gridHeight;
  const gpuOutputBuffer = totalPoints * 1 * 4;
  const totalGPUMemory = gpuOutputBuffer;
  const configuredLimit = config.maxGPUMemoryMB * 1024 * 1024;
  const deviceLimit = deviceCapabilities.maxStorageBufferBindingSize;
  const maxSafeSize = Math.min(configuredLimit, deviceLimit) * config.gpuMemorySafetyMargin;
  return totalGPUMemory > maxSafeSize;
}
async function rasterizeMesh(triangles, stepSize, filterMode, options = {}) {
  const boundsOverride = options.bounds || options.min ? options : null;
  const bounds = boundsOverride || calculateBounds(triangles);
  if (shouldUseTiling(bounds, stepSize)) {
    debug.log("Tiling required - switching to tiled rasterization");
    const configuredLimit = config.maxGPUMemoryMB * 1024 * 1024;
    const deviceLimit = deviceCapabilities.maxStorageBufferBindingSize;
    const maxSafeSize = Math.min(configuredLimit, deviceLimit) * config.gpuMemorySafetyMargin;
    const { tiles } = createTiles(bounds, stepSize, maxSafeSize);
    const tileResults = [];
    for (let i = 0; i < tiles.length; i++) {
      const tileStart = performance.now();
      debug.log(`Processing tile ${i + 1}/${tiles.length}: ${tiles[i].id}`);
      debug.log(`  Tile bounds: min(${tiles[i].bounds.min.x.toFixed(2)}, ${tiles[i].bounds.min.y.toFixed(2)}) max(${tiles[i].bounds.max.x.toFixed(2)}, ${tiles[i].bounds.max.y.toFixed(2)})`);
      const tileResult = await rasterizeMeshSingle(triangles, stepSize, filterMode, {
        ...tiles[i].bounds
      });
      const tileTime = performance.now() - tileStart;
      debug.log(`  Tile ${i + 1} complete: ${tileResult.pointCount} points in ${tileTime.toFixed(1)}ms`);
      tileResult.tileBounds = tiles[i].bounds;
      tileResults.push(tileResult);
    }
    return stitchTiles(tileResults, bounds, stepSize);
  } else {
    return await rasterizeMeshSingle(triangles, stepSize, filterMode, options);
  }
}
function createHeightMapFromPoints(points, gridStep, bounds = null) {
  if (!points || points.length === 0) {
    throw new Error("No points provided");
  }
  if (!bounds) {
    throw new Error("Bounds required for height map creation");
  }
  const minX = bounds.min.x;
  const minY = bounds.min.y;
  const minZ = bounds.min.z;
  const maxX = bounds.max.x;
  const maxY = bounds.max.y;
  const maxZ = bounds.max.z;
  const width = Math.ceil((maxX - minX) / gridStep) + 1;
  const height = Math.ceil((maxY - minY) / gridStep) + 1;
  return {
    grid: points,
    // Dense Z-only array
    width,
    height,
    minX,
    minY,
    minZ,
    maxX,
    maxY,
    maxZ
  };
}

// src/core/raster-tool.js
function createSparseToolFromPoints(points) {
  if (!points || points.length === 0) {
    throw new Error("No tool points provided");
  }
  let minGridX = Infinity, minGridY = Infinity, minZ = Infinity;
  let maxGridX = -Infinity, maxGridY = -Infinity;
  for (let i = 0; i < points.length; i += 3) {
    const gridX = points[i];
    const gridY = points[i + 1];
    const z = points[i + 2];
    minGridX = Math.min(minGridX, gridX);
    maxGridX = Math.max(maxGridX, gridX);
    minGridY = Math.min(minGridY, gridY);
    maxGridY = Math.max(maxGridY, gridY);
    minZ = Math.min(minZ, z);
  }
  const width = Math.floor(maxGridX - minGridX) + 1;
  const height = Math.floor(maxGridY - minGridY) + 1;
  const centerX = Math.floor(minGridX) + Math.floor(width / 2);
  const centerY = Math.floor(minGridY) + Math.floor(height / 2);
  const xOffsets = [];
  const yOffsets = [];
  const zValues = [];
  for (let i = 0; i < points.length; i += 3) {
    const gridX = Math.floor(points[i]);
    const gridY = Math.floor(points[i + 1]);
    const z = points[i + 2];
    const xOffset = gridX - centerX;
    const yOffset = gridY - centerY;
    const zValue = z;
    xOffsets.push(xOffset);
    yOffsets.push(yOffset);
    zValues.push(zValue);
  }
  return {
    count: xOffsets.length,
    xOffsets: new Int32Array(xOffsets),
    yOffsets: new Int32Array(yOffsets),
    zValues: new Float32Array(zValues),
    referenceZ: minZ
  };
}

// src/core/path-planar.js
async function generateToolpathSingle(terrainPoints, toolPoints, xStep, yStep, oobZ, gridStep, terrainBounds = null) {
  const startTime = performance.now();
  debug.log("Generating toolpath...");
  debug.log(`Input: terrain ${terrainPoints.length / 3} points, tool ${toolPoints.length / 3} points, steps (${xStep}, ${yStep}), oobZ ${oobZ}, gridStep ${gridStep}`);
  if (terrainBounds) {
    debug.log(`Using terrain bounds: min(${terrainBounds.min.x.toFixed(2)}, ${terrainBounds.min.y.toFixed(2)}, ${terrainBounds.min.z.toFixed(2)}) max(${terrainBounds.max.x.toFixed(2)}, ${terrainBounds.max.y.toFixed(2)}, ${terrainBounds.max.z.toFixed(2)})`);
  }
  try {
    const terrainMapData = createHeightMapFromPoints(terrainPoints, gridStep, terrainBounds);
    debug.log(`Created terrain map: ${terrainMapData.width}x${terrainMapData.height}`);
    const sparseToolData = createSparseToolFromPoints(toolPoints);
    debug.log(`Created sparse tool: ${sparseToolData.count} points`);
    const result = await runToolpathCompute(
      terrainMapData,
      sparseToolData,
      xStep,
      yStep,
      oobZ,
      startTime
    );
    return result;
  } catch (error) {
    debug.error("Error generating toolpath:", error);
    throw error;
  }
}
async function runToolpathCompute(terrainMapData, sparseToolData, xStep, yStep, oobZ, startTime) {
  if (!isInitialized) {
    const success = await initWebGPU();
    if (!success) {
      throw new Error("WebGPU not available");
    }
  }
  const terrainBuffer = device.createBuffer({
    size: terrainMapData.grid.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
  });
  device.queue.writeBuffer(terrainBuffer, 0, terrainMapData.grid);
  const toolBufferData = new ArrayBuffer(sparseToolData.count * 16);
  const toolBufferI32 = new Int32Array(toolBufferData);
  const toolBufferF32 = new Float32Array(toolBufferData);
  for (let i = 0; i < sparseToolData.count; i++) {
    toolBufferI32[i * 4 + 0] = sparseToolData.xOffsets[i];
    toolBufferI32[i * 4 + 1] = sparseToolData.yOffsets[i];
    toolBufferF32[i * 4 + 2] = sparseToolData.zValues[i];
    toolBufferF32[i * 4 + 3] = 0;
  }
  const toolBuffer = device.createBuffer({
    size: toolBufferData.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
  });
  device.queue.writeBuffer(toolBuffer, 0, toolBufferData);
  const pointsPerLine = Math.ceil(terrainMapData.width / xStep);
  const numScanlines = Math.ceil(terrainMapData.height / yStep);
  const outputSize = pointsPerLine * numScanlines;
  const outputBuffer = device.createBuffer({
    size: outputSize * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
  });
  const uniformData = new Uint32Array([
    terrainMapData.width,
    terrainMapData.height,
    sparseToolData.count,
    xStep,
    yStep,
    0,
    pointsPerLine,
    numScanlines,
    0
    // y_offset (default 0 for planar mode)
  ]);
  const uniformDataFloat = new Float32Array(uniformData.buffer);
  uniformDataFloat[5] = oobZ;
  const uniformBuffer = device.createBuffer({
    size: uniformData.byteLength,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
  });
  device.queue.writeBuffer(uniformBuffer, 0, uniformData);
  await device.queue.onSubmittedWorkDone();
  const bindGroup = device.createBindGroup({
    layout: cachedToolpathPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: terrainBuffer } },
      { binding: 1, resource: { buffer: toolBuffer } },
      { binding: 2, resource: { buffer: outputBuffer } },
      { binding: 3, resource: { buffer: uniformBuffer } }
    ]
  });
  const commandEncoder = device.createCommandEncoder();
  const passEncoder = commandEncoder.beginComputePass();
  passEncoder.setPipeline(cachedToolpathPipeline);
  passEncoder.setBindGroup(0, bindGroup);
  const workgroupsX = Math.ceil(pointsPerLine / 16);
  const workgroupsY = Math.ceil(numScanlines / 16);
  passEncoder.dispatchWorkgroups(workgroupsX, workgroupsY);
  passEncoder.end();
  const stagingBuffer = device.createBuffer({
    size: outputSize * 4,
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST
  });
  commandEncoder.copyBufferToBuffer(outputBuffer, 0, stagingBuffer, 0, outputSize * 4);
  device.queue.submit([commandEncoder.finish()]);
  await device.queue.onSubmittedWorkDone();
  await stagingBuffer.mapAsync(GPUMapMode.READ);
  const outputData = new Float32Array(stagingBuffer.getMappedRange());
  const result = new Float32Array(outputData);
  stagingBuffer.unmap();
  terrainBuffer.destroy();
  toolBuffer.destroy();
  outputBuffer.destroy();
  uniformBuffer.destroy();
  stagingBuffer.destroy();
  const endTime = performance.now();
  return {
    pathData: result,
    numScanlines,
    pointsPerLine,
    generationTime: endTime - startTime
  };
}
function createReusableToolpathBuffers(terrainWidth, terrainHeight, sparseToolData, xStep, yStep) {
  const pointsPerLine = Math.ceil(terrainWidth / xStep);
  const numScanlines = Math.ceil(terrainHeight / yStep);
  const outputSize = pointsPerLine * numScanlines;
  const terrainBuffer = device.createBuffer({
    size: terrainWidth * terrainHeight * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
  });
  const toolBufferData = new ArrayBuffer(sparseToolData.count * 16);
  const toolBufferI32 = new Int32Array(toolBufferData);
  const toolBufferF32 = new Float32Array(toolBufferData);
  for (let i = 0; i < sparseToolData.count; i++) {
    toolBufferI32[i * 4 + 0] = sparseToolData.xOffsets[i];
    toolBufferI32[i * 4 + 1] = sparseToolData.yOffsets[i];
    toolBufferF32[i * 4 + 2] = sparseToolData.zValues[i];
    toolBufferF32[i * 4 + 3] = 0;
  }
  const toolBuffer = device.createBuffer({
    size: toolBufferData.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
  });
  device.queue.writeBuffer(toolBuffer, 0, toolBufferData);
  const outputBuffer = device.createBuffer({
    size: outputSize * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
  });
  const uniformBuffer = device.createBuffer({
    size: 36,
    // 9 fields × 4 bytes (added y_offset field)
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
  });
  const stagingBuffer = device.createBuffer({
    size: outputSize * 4,
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST
  });
  return {
    terrainBuffer,
    toolBuffer,
    outputBuffer,
    uniformBuffer,
    stagingBuffer,
    maxOutputSize: outputSize,
    maxTerrainWidth: terrainWidth,
    maxTerrainHeight: terrainHeight,
    sparseToolData
  };
}
function destroyReusableToolpathBuffers(buffers) {
  buffers.terrainBuffer.destroy();
  buffers.toolBuffer.destroy();
  buffers.outputBuffer.destroy();
  buffers.uniformBuffer.destroy();
  buffers.stagingBuffer.destroy();
}
async function runToolpathComputeWithBuffers(terrainData, terrainWidth, terrainHeight, xStep, yStep, oobZ, buffers, startTime) {
  device.queue.writeBuffer(buffers.terrainBuffer, 0, terrainData);
  const pointsPerLine = Math.ceil(terrainWidth / xStep);
  const numScanlines = Math.ceil(terrainHeight / yStep);
  const outputSize = pointsPerLine * numScanlines;
  const yOffset = numScanlines === 1 && terrainHeight > 1 ? Math.floor(terrainHeight / 2) : 0;
  const uniformData = new Uint32Array([
    terrainWidth,
    terrainHeight,
    buffers.sparseToolData.count,
    xStep,
    yStep,
    0,
    pointsPerLine,
    numScanlines,
    yOffset
    // y_offset for radial single-scanline mode
  ]);
  const uniformDataFloat = new Float32Array(uniformData.buffer);
  uniformDataFloat[5] = oobZ;
  device.queue.writeBuffer(buffers.uniformBuffer, 0, uniformData);
  await device.queue.onSubmittedWorkDone();
  const bindGroup = device.createBindGroup({
    layout: cachedToolpathPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: buffers.terrainBuffer } },
      { binding: 1, resource: { buffer: buffers.toolBuffer } },
      { binding: 2, resource: { buffer: buffers.outputBuffer } },
      { binding: 3, resource: { buffer: buffers.uniformBuffer } }
    ]
  });
  const commandEncoder = device.createCommandEncoder();
  const passEncoder = commandEncoder.beginComputePass();
  passEncoder.setPipeline(cachedToolpathPipeline);
  passEncoder.setBindGroup(0, bindGroup);
  const workgroupsX = Math.ceil(pointsPerLine / 16);
  const workgroupsY = Math.ceil(numScanlines / 16);
  passEncoder.dispatchWorkgroups(workgroupsX, workgroupsY);
  passEncoder.end();
  commandEncoder.copyBufferToBuffer(buffers.outputBuffer, 0, buffers.stagingBuffer, 0, outputSize * 4);
  device.queue.submit([commandEncoder.finish()]);
  await device.queue.onSubmittedWorkDone();
  await buffers.stagingBuffer.mapAsync(GPUMapMode.READ);
  const outputData = new Float32Array(buffers.stagingBuffer.getMappedRange(), 0, outputSize);
  const result = outputData.slice();
  buffers.stagingBuffer.unmap();
  const endTime = performance.now();
  if (result.length > 0) {
    const samples = [];
    for (let i = 0; i < Math.min(10, result.length); i++) {
      samples.push(result[i].toFixed(3));
    }
  }
  return {
    pathData: result,
    numScanlines,
    pointsPerLine,
    generationTime: endTime - startTime
  };
}
async function generateToolpath(terrainPoints, toolPoints, xStep, yStep, oobZ, gridStep, terrainBounds = null, singleScanline = false) {
  if (!terrainBounds) {
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < terrainPoints.length; i += 3) {
      minX = Math.min(minX, terrainPoints[i]);
      maxX = Math.max(maxX, terrainPoints[i]);
      minY = Math.min(minY, terrainPoints[i + 1]);
      maxY = Math.max(maxY, terrainPoints[i + 1]);
      minZ = Math.min(minZ, terrainPoints[i + 2]);
      maxZ = Math.max(maxZ, terrainPoints[i + 2]);
    }
    terrainBounds = {
      min: { x: minX, y: minY, z: minZ },
      max: { x: maxX, y: maxY, z: maxZ }
    };
  }
  for (let i = 0; i < toolPoints.length; i += 3) {
    if (toolPoints[i] === 0 && toolPoints[i + 1] === 0) {
      debug.log("[WebGPU Worker]", { TOOL_CENTER: toolPoints[i + 2] });
    }
  }
  debug.log(
    "[WebGPU Worker]",
    "toolZMin:",
    [...toolPoints].filter((_, i) => i % 3 === 2).reduce((a, b) => Math.min(a, b), Infinity),
    "toolZMax:",
    [...toolPoints].filter((_, i) => i % 3 === 2).reduce((a, b) => Math.max(a, b), -Infinity)
  );
  let toolMinX = Infinity, toolMaxX = -Infinity;
  let toolMinY = Infinity, toolMaxY = -Infinity;
  for (let i = 0; i < toolPoints.length; i += 3) {
    toolMinX = Math.min(toolMinX, toolPoints[i]);
    toolMaxX = Math.max(toolMaxX, toolPoints[i]);
    toolMinY = Math.min(toolMinY, toolPoints[i + 1]);
    toolMaxY = Math.max(toolMaxY, toolPoints[i + 1]);
  }
  const toolWidthCells = toolMaxX - toolMinX;
  const toolHeightCells = toolMaxY - toolMinY;
  const toolWidthMm = toolWidthCells * gridStep;
  const toolHeightMm = toolHeightCells * gridStep;
  const outputWidth = Math.ceil((terrainBounds.max.x - terrainBounds.min.x) / gridStep) + 1;
  const outputHeight = Math.ceil((terrainBounds.max.y - terrainBounds.min.y) / gridStep) + 1;
  const outputPoints = Math.ceil(outputWidth / xStep) * Math.ceil(outputHeight / yStep);
  const outputMemory = outputPoints * 4;
  const configuredLimit = config.maxGPUMemoryMB * 1024 * 1024;
  const deviceLimit = deviceCapabilities.maxStorageBufferBindingSize;
  const maxSafeSize = Math.min(configuredLimit, deviceLimit) * config.gpuMemorySafetyMargin;
  if (outputMemory <= maxSafeSize) {
    return await generateToolpathSingle(terrainPoints, toolPoints, xStep, yStep, oobZ, gridStep, terrainBounds);
  }
  const tilingStartTime = performance.now();
  debug.log("Using tiled toolpath generation");
  debug.log(`Terrain: DENSE (${terrainPoints.length} cells = ${outputWidth}x${outputHeight})`);
  debug.log(`Tool dimensions: ${toolWidthMm.toFixed(2)}mm \xD7 ${toolHeightMm.toFixed(2)}mm (${toolWidthCells}\xD7${toolHeightCells} cells)`);
  const { tiles, maxTileGridWidth, maxTileGridHeight } = createToolpathTiles(terrainBounds, gridStep, xStep, yStep, toolWidthCells, toolHeightCells, maxSafeSize);
  debug.log(`Created ${tiles.length} tiles`);
  const pregenStartTime = performance.now();
  debug.log(`Pre-generating ${tiles.length} tile terrain arrays...`);
  const allTileTerrainPoints = [];
  for (let i = 0; i < tiles.length; i++) {
    const tile = tiles[i];
    const tileMinGridX = Math.floor((tile.bounds.min.x - terrainBounds.min.x) / gridStep);
    const tileMaxGridX = Math.ceil((tile.bounds.max.x - terrainBounds.min.x) / gridStep);
    const tileMinGridY = Math.floor((tile.bounds.min.y - terrainBounds.min.y) / gridStep);
    const tileMaxGridY = Math.ceil((tile.bounds.max.y - terrainBounds.min.y) / gridStep);
    const tileWidth = tileMaxGridX - tileMinGridX + 1;
    const tileHeight = tileMaxGridY - tileMinGridY + 1;
    const paddedTileTerrainPoints = new Float32Array(maxTileGridWidth * maxTileGridHeight);
    paddedTileTerrainPoints.fill(EMPTY_CELL);
    for (let ty = 0; ty < tileHeight; ty++) {
      const globalY = tileMinGridY + ty;
      if (globalY < 0 || globalY >= outputHeight) continue;
      for (let tx = 0; tx < tileWidth; tx++) {
        const globalX = tileMinGridX + tx;
        if (globalX < 0 || globalX >= outputWidth) continue;
        const globalIdx = globalY * outputWidth + globalX;
        const tileIdx = ty * maxTileGridWidth + tx;
        paddedTileTerrainPoints[tileIdx] = terrainPoints[globalIdx];
      }
    }
    allTileTerrainPoints.push({
      data: paddedTileTerrainPoints,
      actualWidth: tileWidth,
      actualHeight: tileHeight
    });
  }
  const pregenTime = performance.now() - pregenStartTime;
  debug.log(`Pre-generation complete in ${pregenTime.toFixed(1)}ms`);
  if (!isInitialized) {
    const success = await initWebGPU();
    if (!success) {
      throw new Error("WebGPU not available");
    }
  }
  const sparseToolData = createSparseToolFromPoints(toolPoints);
  const reusableBuffers = createReusableToolpathBuffers(maxTileGridWidth, maxTileGridHeight, sparseToolData, xStep, yStep);
  debug.log(`Created reusable GPU buffers for ${maxTileGridWidth}x${maxTileGridHeight} tiles`);
  const tileResults = [];
  let totalTileTime = 0;
  for (let i = 0; i < tiles.length; i++) {
    const tile = tiles[i];
    const tileStartTime = performance.now();
    debug.log(`Processing tile ${i + 1}/${tiles.length}...`);
    const percent = Math.round((i + 1) / tiles.length * 100);
    self.postMessage({
      type: "toolpath-progress",
      data: {
        percent,
        current: i + 1,
        total: tiles.length,
        layer: i + 1
        // Using tile index as "layer" for consistency
      }
    });
    debug.log(`Tile ${i + 1} using pre-generated terrain: ${allTileTerrainPoints[i].actualWidth}x${allTileTerrainPoints[i].actualHeight} (padded to ${maxTileGridWidth}x${maxTileGridHeight})`);
    const tileToolpathResult = await runToolpathComputeWithBuffers(
      allTileTerrainPoints[i].data,
      maxTileGridWidth,
      maxTileGridHeight,
      xStep,
      yStep,
      oobZ,
      reusableBuffers,
      tileStartTime
    );
    const tileTime = performance.now() - tileStartTime;
    totalTileTime += tileTime;
    tileResults.push({
      pathData: tileToolpathResult.pathData,
      numScanlines: tileToolpathResult.numScanlines,
      pointsPerLine: tileToolpathResult.pointsPerLine,
      tile
    });
    debug.log(`Tile ${i + 1}/${tiles.length} complete: ${tileToolpathResult.numScanlines}\xD7${tileToolpathResult.pointsPerLine} in ${tileTime.toFixed(1)}ms`);
  }
  destroyReusableToolpathBuffers(reusableBuffers);
  debug.log(`All tiles processed in ${totalTileTime.toFixed(1)}ms (avg ${(totalTileTime / tiles.length).toFixed(1)}ms per tile)`);
  const stitchStartTime = performance.now();
  const stitchedResult = stitchToolpathTiles(tileResults, terrainBounds, gridStep, xStep, yStep);
  const stitchTime = performance.now() - stitchStartTime;
  const totalTime = performance.now() - tilingStartTime;
  debug.log(`Stitching took ${stitchTime.toFixed(1)}ms`);
  debug.log(`Tiled toolpath complete: ${stitchedResult.numScanlines}\xD7${stitchedResult.pointsPerLine} in ${totalTime.toFixed(1)}ms total`);
  stitchedResult.generationTime = totalTime;
  return stitchedResult;
}
function createToolpathTiles(bounds, gridStep, xStep, yStep, toolWidthCells, toolHeightCells, maxMemoryBytes) {
  const globalGridWidth = Math.ceil((bounds.max.x - bounds.min.x) / gridStep) + 1;
  const globalGridHeight = Math.ceil((bounds.max.y - bounds.min.y) / gridStep) + 1;
  const toolOverlapX = Math.ceil(toolWidthCells / 2);
  const toolOverlapY = Math.ceil(toolHeightCells / 2);
  let low = Math.max(toolOverlapX, toolOverlapY) * 2;
  let high = Math.max(globalGridWidth, globalGridHeight);
  let bestTileGridSize = high;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const outputW = Math.ceil(mid / xStep);
    const outputH = Math.ceil(mid / yStep);
    const memoryNeeded = outputW * outputH * 4;
    if (memoryNeeded <= maxMemoryBytes) {
      bestTileGridSize = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  const tilesX = Math.ceil(globalGridWidth / bestTileGridSize);
  const tilesY = Math.ceil(globalGridHeight / bestTileGridSize);
  const coreGridWidth = Math.ceil(globalGridWidth / tilesX);
  const coreGridHeight = Math.ceil(globalGridHeight / tilesY);
  const maxTileGridWidth = coreGridWidth + 2 * toolOverlapX;
  const maxTileGridHeight = coreGridHeight + 2 * toolOverlapY;
  debug.log(`Creating ${tilesX}\xD7${tilesY} tiles (${coreGridWidth}\xD7${coreGridHeight} cells core + ${toolOverlapX}\xD7${toolOverlapY} cells overlap)`);
  debug.log(`Max tile dimensions: ${maxTileGridWidth}\xD7${maxTileGridHeight} cells (for buffer sizing)`);
  const tiles = [];
  for (let ty = 0; ty < tilesY; ty++) {
    for (let tx = 0; tx < tilesX; tx++) {
      const coreGridStartX = tx * coreGridWidth;
      const coreGridStartY = ty * coreGridHeight;
      const coreGridEndX = Math.min((tx + 1) * coreGridWidth, globalGridWidth) - 1;
      const coreGridEndY = Math.min((ty + 1) * coreGridHeight, globalGridHeight) - 1;
      let extGridStartX = coreGridStartX;
      let extGridStartY = coreGridStartY;
      let extGridEndX = coreGridEndX;
      let extGridEndY = coreGridEndY;
      if (tx > 0) extGridStartX -= toolOverlapX;
      if (ty > 0) extGridStartY -= toolOverlapY;
      if (tx < tilesX - 1) extGridEndX += toolOverlapX;
      if (ty < tilesY - 1) extGridEndY += toolOverlapY;
      extGridStartX = Math.max(0, extGridStartX);
      extGridStartY = Math.max(0, extGridStartY);
      extGridEndX = Math.min(globalGridWidth - 1, extGridEndX);
      extGridEndY = Math.min(globalGridHeight - 1, extGridEndY);
      const tileGridWidth = extGridEndX - extGridStartX + 1;
      const tileGridHeight = extGridEndY - extGridStartY + 1;
      const extMinX = bounds.min.x + extGridStartX * gridStep;
      const extMinY = bounds.min.y + extGridStartY * gridStep;
      const extMaxX = bounds.min.x + extGridEndX * gridStep;
      const extMaxY = bounds.min.y + extGridEndY * gridStep;
      const coreMinX = bounds.min.x + coreGridStartX * gridStep;
      const coreMinY = bounds.min.y + coreGridStartY * gridStep;
      const coreMaxX = bounds.min.x + coreGridEndX * gridStep;
      const coreMaxY = bounds.min.y + coreGridEndY * gridStep;
      tiles.push({
        id: `tile_${tx}_${ty}`,
        tx,
        ty,
        tilesX,
        tilesY,
        gridWidth: tileGridWidth,
        gridHeight: tileGridHeight,
        bounds: {
          min: { x: extMinX, y: extMinY, z: bounds.min.z },
          max: { x: extMaxX, y: extMaxY, z: bounds.max.z }
        },
        core: {
          gridStart: { x: coreGridStartX, y: coreGridStartY },
          gridEnd: { x: coreGridEndX, y: coreGridEndY },
          min: { x: coreMinX, y: coreMinY },
          max: { x: coreMaxX, y: coreMaxY }
        }
      });
    }
  }
  return { tiles, maxTileGridWidth, maxTileGridHeight };
}
function stitchToolpathTiles(tileResults, globalBounds, gridStep, xStep, yStep) {
  const globalWidth = Math.ceil((globalBounds.max.x - globalBounds.min.x) / gridStep) + 1;
  const globalHeight = Math.ceil((globalBounds.max.y - globalBounds.min.y) / gridStep) + 1;
  const globalPointsPerLine = Math.ceil(globalWidth / xStep);
  const globalNumScanlines = Math.ceil(globalHeight / yStep);
  debug.log(`Stitching toolpath: global grid ${globalWidth}x${globalHeight}, output ${globalPointsPerLine}x${globalNumScanlines}`);
  const result = new Float32Array(globalPointsPerLine * globalNumScanlines);
  result.fill(NaN);
  const use1x1FastPath = xStep === 1 && yStep === 1;
  for (const tileResult of tileResults) {
    const tile = tileResult.tile;
    const tileData = tileResult.pathData;
    const coreGridStartX = tile.core.gridStart.x;
    const coreGridStartY = tile.core.gridStart.y;
    const coreGridEndX = tile.core.gridEnd.x;
    const coreGridEndY = tile.core.gridEnd.y;
    const extGridStartX = Math.round((tile.bounds.min.x - globalBounds.min.x) / gridStep);
    const extGridStartY = Math.round((tile.bounds.min.y - globalBounds.min.y) / gridStep);
    let copiedCount = 0;
    const coreGridWidth = coreGridEndX - coreGridStartX + 1;
    const coreGridHeight = coreGridEndY - coreGridStartY + 1;
    const coreOutStartX = Math.floor(coreGridStartX / xStep);
    const coreOutStartY = Math.floor(coreGridStartY / yStep);
    const coreOutEndX = Math.floor(coreGridEndX / xStep);
    const coreOutEndY = Math.floor(coreGridEndY / yStep);
    const coreOutWidth = coreOutEndX - coreOutStartX + 1;
    const coreOutHeight = coreOutEndY - coreOutStartY + 1;
    const extOutStartX = Math.floor(extGridStartX / xStep);
    const extOutStartY = Math.floor(extGridStartY / yStep);
    for (let outY = 0; outY < coreOutHeight; outY++) {
      const globalOutY = coreOutStartY + outY;
      const tileOutY = globalOutY - extOutStartY;
      if (globalOutY >= 0 && globalOutY < globalNumScanlines && tileOutY >= 0 && tileOutY < tileResult.numScanlines) {
        const globalRowStart = globalOutY * globalPointsPerLine + coreOutStartX;
        const tileRowStart = tileOutY * tileResult.pointsPerLine + (coreOutStartX - extOutStartX);
        result.set(tileData.subarray(tileRowStart, tileRowStart + coreOutWidth), globalRowStart);
        copiedCount += coreOutWidth;
      }
    }
    debug.log(`  Tile ${tile.id}: copied ${copiedCount} values`);
  }
  let nanCount = 0;
  for (let i = 0; i < result.length; i++) {
    if (isNaN(result[i])) nanCount++;
  }
  debug.log(`Stitching complete: ${result.length} total values, ${nanCount} still NaN`);
  return {
    pathData: result,
    numScanlines: globalNumScanlines,
    pointsPerLine: globalPointsPerLine,
    generationTime: 0
    // Sum from tiles if needed
  };
}

// src/core/path-radial.js
async function radialRasterize({
  triangles,
  bucketData,
  resolution,
  angleStep,
  numAngles,
  maxRadius,
  toolWidth,
  zFloor,
  bounds,
  startAngle = 0,
  reusableBuffers = null,
  returnBuffersForReuse = false,
  batchInfo = {}
}) {
  if (!device) {
    throw new Error("WebGPU not initialized");
  }
  const timings = {
    start: performance.now(),
    prep: 0,
    gpu: 0,
    stitch: 0
  };
  const bucketMinX = bucketData.buckets[0].minX;
  const bucketMaxX = bucketData.buckets[bucketData.numBuckets - 1].maxX;
  const gridWidth = Math.ceil((bucketMaxX - bucketMinX) / resolution);
  const gridYHeight = Math.ceil(toolWidth / resolution);
  const bucketGridWidth = Math.ceil((bucketData.buckets[0].maxX - bucketData.buckets[0].minX) / resolution);
  const bucketTriangleCounts = bucketData.buckets.map((b) => b.count);
  const minTriangles = Math.min(...bucketTriangleCounts);
  const maxTriangles = Math.max(...bucketTriangleCounts);
  const avgTriangles = bucketTriangleCounts.reduce((a, b) => a + b, 0) / bucketTriangleCounts.length;
  const workPerWorkgroup = maxTriangles * numAngles * bucketGridWidth * gridYHeight;
  const maxWorkPerBatch = 1e10;
  const estimatedWorkPerBucket = avgTriangles * numAngles * bucketGridWidth * gridYHeight;
  const THREADS_PER_WORKGROUP = 64;
  const maxConcurrentThreads = config.maxConcurrentThreads || 32768;
  const dispatchX = Math.ceil(numAngles / 8);
  const dispatchY = Math.ceil(gridYHeight / 8);
  const threadsPerBucket = dispatchX * dispatchY * THREADS_PER_WORKGROUP;
  const threadLimitBuckets = Math.max(1, Math.floor(maxConcurrentThreads / threadsPerBucket));
  let maxBucketsPerBatch;
  if (estimatedWorkPerBucket === 0) {
    maxBucketsPerBatch = Math.min(threadLimitBuckets, bucketData.numBuckets);
  } else {
    const workBasedLimit = Math.floor(maxWorkPerBatch / estimatedWorkPerBucket);
    const idealBucketsPerBatch = Math.min(workBasedLimit, threadLimitBuckets);
    const minBucketsPerBatch = Math.min(4, bucketData.numBuckets, threadLimitBuckets);
    maxBucketsPerBatch = Math.max(minBucketsPerBatch, idealBucketsPerBatch);
    maxBucketsPerBatch = Math.min(maxBucketsPerBatch, bucketData.numBuckets);
  }
  const numBucketBatches = Math.ceil(bucketData.numBuckets / maxBucketsPerBatch);
  if (diagnostic) {
    debug.log(`Radial: ${gridWidth}x${gridYHeight} grid, ${numAngles} angles, ${bucketData.buckets.length} buckets`);
    debug.log(`Load: min=${minTriangles} max=${maxTriangles} avg=${avgTriangles.toFixed(0)} (${(maxTriangles / avgTriangles).toFixed(2)}x imbalance, worst=${(workPerWorkgroup / 1e6).toFixed(1)}M tests)`);
    debug.log(`Thread limits: ${threadsPerBucket} threads/bucket, max ${threadLimitBuckets} buckets/dispatch (${maxConcurrentThreads} thread limit)`);
    debug.log(`Estimated work/bucket: ${(estimatedWorkPerBucket / 1e6).toFixed(1)}M tests`);
    debug.log(`Bucket batching: ${numBucketBatches} batches of ${maxBucketsPerBatch} buckets (work limit: ${Math.floor(maxWorkPerBatch / estimatedWorkPerBucket)}, thread limit: ${threadLimitBuckets})`);
  }
  let triangleBuffer, triangleIndicesBuffer;
  let shouldCleanupBuffers = false;
  if (reusableBuffers) {
    triangleBuffer = reusableBuffers.triangleBuffer;
    triangleIndicesBuffer = reusableBuffers.triangleIndicesBuffer;
  } else {
    shouldCleanupBuffers = true;
    triangleBuffer = device.createBuffer({
      size: triangles.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true
    });
    new Float32Array(triangleBuffer.getMappedRange()).set(triangles);
    triangleBuffer.unmap();
    triangleIndicesBuffer = device.createBuffer({
      size: bucketData.triangleIndices.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true
    });
    new Uint32Array(triangleIndicesBuffer.getMappedRange()).set(bucketData.triangleIndices);
    triangleIndicesBuffer.unmap();
  }
  const outputSize = numAngles * bucketData.numBuckets * bucketGridWidth * gridYHeight * 4;
  const outputBuffer = device.createBuffer({
    size: outputSize,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST
  });
  const initData = new Float32Array(outputSize / 4);
  initData.fill(zFloor);
  device.queue.writeBuffer(outputBuffer, 0, initData);
  timings.prep = performance.now() - timings.start;
  const gpuStart = performance.now();
  const pipeline = cachedRadialBatchPipeline;
  const commandEncoder = device.createCommandEncoder();
  const passEncoder = commandEncoder.beginComputePass();
  passEncoder.setPipeline(pipeline);
  const batchBuffersToDestroy = [];
  for (let batchIdx = 0; batchIdx < numBucketBatches; batchIdx++) {
    const startBucket = batchIdx * maxBucketsPerBatch;
    const endBucket = Math.min(startBucket + maxBucketsPerBatch, bucketData.numBuckets);
    const bucketsInBatch = endBucket - startBucket;
    const bucketInfoSize = bucketsInBatch * 16;
    const bucketInfoBuffer = device.createBuffer({
      size: bucketInfoSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true
    });
    const bucketView = new ArrayBuffer(bucketInfoSize);
    const bucketFloatView = new Float32Array(bucketView);
    const bucketUintView = new Uint32Array(bucketView);
    for (let i = 0; i < bucketsInBatch; i++) {
      const bucket = bucketData.buckets[startBucket + i];
      const offset = i * 4;
      bucketFloatView[offset] = bucket.minX;
      bucketFloatView[offset + 1] = bucket.maxX;
      bucketUintView[offset + 2] = bucket.startIndex;
      bucketUintView[offset + 3] = bucket.count;
    }
    new Uint8Array(bucketInfoBuffer.getMappedRange()).set(new Uint8Array(bucketView));
    bucketInfoBuffer.unmap();
    const uniformBuffer = device.createBuffer({
      size: 56,
      // 14 fields * 4 bytes
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true
    });
    const uniformView = new ArrayBuffer(56);
    const floatView = new Float32Array(uniformView);
    const uintView = new Uint32Array(uniformView);
    floatView[0] = resolution;
    floatView[1] = angleStep * (Math.PI / 180);
    uintView[2] = numAngles;
    floatView[3] = maxRadius;
    floatView[4] = toolWidth;
    uintView[5] = gridYHeight;
    floatView[6] = bucketData.buckets[0].maxX - bucketData.buckets[0].minX;
    uintView[7] = bucketGridWidth;
    floatView[8] = bucketMinX;
    floatView[9] = zFloor;
    uintView[10] = 0;
    uintView[11] = bucketData.numBuckets;
    floatView[12] = startAngle * (Math.PI / 180);
    uintView[13] = startBucket;
    new Uint8Array(uniformBuffer.getMappedRange()).set(new Uint8Array(uniformView));
    uniformBuffer.unmap();
    const bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: triangleBuffer } },
        { binding: 1, resource: { buffer: outputBuffer } },
        { binding: 2, resource: { buffer: uniformBuffer } },
        { binding: 3, resource: { buffer: bucketInfoBuffer } },
        { binding: 4, resource: { buffer: triangleIndicesBuffer } }
      ]
    });
    passEncoder.setBindGroup(0, bindGroup);
    passEncoder.dispatchWorkgroups(dispatchX, dispatchY, bucketsInBatch);
    if (diagnostic) {
      const totalThreads = dispatchX * dispatchY * bucketsInBatch * THREADS_PER_WORKGROUP;
      debug.log(`  Batch ${batchIdx + 1}/${numBucketBatches}: (${dispatchX}, ${dispatchY}, ${bucketsInBatch}) = ${totalThreads} threads, buckets ${startBucket}-${endBucket - 1}`);
    }
    batchBuffersToDestroy.push(uniformBuffer, bucketInfoBuffer);
  }
  passEncoder.end();
  const stagingBuffer = device.createBuffer({
    size: outputSize,
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST
  });
  commandEncoder.copyBufferToBuffer(outputBuffer, 0, stagingBuffer, 0, outputSize);
  device.queue.submit([commandEncoder.finish()]);
  await device.queue.onSubmittedWorkDone();
  await stagingBuffer.mapAsync(GPUMapMode.READ);
  const outputCopy = new Float32Array(stagingBuffer.getMappedRange().slice());
  stagingBuffer.unmap();
  for (const buffer of batchBuffersToDestroy) {
    buffer.destroy();
  }
  outputBuffer.destroy();
  stagingBuffer.destroy();
  timings.gpu = performance.now() - gpuStart;
  const stitchStart = performance.now();
  const strips = [];
  for (let angleIdx = 0; angleIdx < numAngles; angleIdx++) {
    const stripData = new Float32Array(gridWidth * gridYHeight);
    stripData.fill(zFloor);
    for (let bucketIdx = 0; bucketIdx < bucketData.numBuckets; bucketIdx++) {
      const bucket = bucketData.buckets[bucketIdx];
      const bucketMinGridX = Math.floor((bucket.minX - bucketMinX) / resolution);
      for (let localX = 0; localX < bucketGridWidth; localX++) {
        const gridX = bucketMinGridX + localX;
        if (gridX >= gridWidth) continue;
        for (let gridY = 0; gridY < gridYHeight; gridY++) {
          const srcIdx = bucketIdx * numAngles * bucketGridWidth * gridYHeight + angleIdx * bucketGridWidth * gridYHeight + gridY * bucketGridWidth + localX;
          const dstIdx = gridY * gridWidth + gridX;
          stripData[dstIdx] = outputCopy[srcIdx];
        }
      }
    }
    let validCount = 0;
    for (let i = 0; i < stripData.length; i++) {
      if (stripData[i] !== zFloor) validCount++;
    }
    strips.push({
      angle: startAngle + angleIdx * angleStep,
      positions: stripData,
      // DENSE Z-only format!
      gridWidth,
      gridHeight: gridYHeight,
      pointCount: validCount,
      // Number of non-floor cells
      bounds: {
        min: { x: bucketMinX, y: 0, z: zFloor },
        max: { x: bucketMaxX, y: toolWidth, z: bounds.max.z }
      }
    });
  }
  timings.stitch = performance.now() - stitchStart;
  const totalTime = performance.now() - timings.start;
  Object.assign(batchInfo, {
    "prep": timings.prep | 0,
    "raster": timings.gpu | 0,
    "stitch": timings.stitch | 0
  });
  const result = { strips, timings };
  if (returnBuffersForReuse && shouldCleanupBuffers) {
    result.reusableBuffers = {
      triangleBuffer,
      triangleIndicesBuffer
    };
  } else if (shouldCleanupBuffers) {
    triangleBuffer.destroy();
    triangleIndicesBuffer.destroy();
  }
  return result;
}
async function generateRadialToolpaths({
  triangles,
  bucketData,
  toolData,
  resolution,
  angleStep,
  numAngles,
  maxRadius,
  toolWidth,
  zFloor,
  bounds,
  xStep,
  yStep
}) {
  debug.log("radial-generate-toolpaths", { triangles: triangles.length, numAngles, resolution });
  const MAX_BUFFER_SIZE_MB = 1800;
  const bytesPerCell = 4;
  const xSize = bounds.max.x - bounds.min.x;
  const ySize = bounds.max.y - bounds.min.y;
  const gridXSize = Math.ceil(xSize / resolution);
  const gridYHeight = Math.ceil(ySize / resolution);
  const cellsPerAngle = gridXSize * gridYHeight;
  const bytesPerAngle = cellsPerAngle * bytesPerCell;
  const totalMemoryMB = numAngles * bytesPerAngle / (1024 * 1024);
  const batchDivisor = config?.batchDivisor || 1;
  let ANGLES_PER_BATCH, numBatches;
  if (totalMemoryMB > MAX_BUFFER_SIZE_MB) {
    const maxAnglesPerBatch = Math.floor(MAX_BUFFER_SIZE_MB * 1024 * 1024 / bytesPerAngle);
    const adjustedMaxAngles = Math.floor(maxAnglesPerBatch / batchDivisor);
    ANGLES_PER_BATCH = Math.max(1, Math.min(adjustedMaxAngles, numAngles));
    numBatches = Math.ceil(numAngles / ANGLES_PER_BATCH);
    const batchSizeMB = (ANGLES_PER_BATCH * bytesPerAngle / 1024 / 1024).toFixed(1);
    debug.log(`Grid: ${gridXSize} x ${gridYHeight}, ${cellsPerAngle.toLocaleString()} cells/angle`);
    debug.log(`Total memory: ${totalMemoryMB.toFixed(1)}MB exceeds limit, batching required`);
    if (batchDivisor > 1) {
      debug.log(`batchDivisor: ${batchDivisor}x (testing overhead: ${maxAnglesPerBatch} \u2192 ${adjustedMaxAngles} angles/batch)`);
    }
    debug.log(`Batch size: ${ANGLES_PER_BATCH} angles (~${batchSizeMB}MB per batch)`);
    debug.log(`Processing ${numAngles} angles in ${numBatches} batch(es)`);
  } else {
    if (batchDivisor > 1) {
      ANGLES_PER_BATCH = Math.max(10, Math.floor(numAngles / batchDivisor));
      numBatches = Math.ceil(numAngles / ANGLES_PER_BATCH);
      debug.log(`Grid: ${gridXSize} x ${gridYHeight}, ${cellsPerAngle.toLocaleString()} cells/angle`);
      debug.log(`Total memory: ${totalMemoryMB.toFixed(1)}MB (fits in buffer normally)`);
      debug.log(`batchDivisor: ${batchDivisor}x (artificially creating ${numBatches} batches for overhead testing)`);
    } else {
      ANGLES_PER_BATCH = numAngles;
      numBatches = 1;
      debug.log(`Grid: ${gridXSize} x ${gridYHeight}, ${cellsPerAngle.toLocaleString()} cells/angle`);
      debug.log(`Total memory: ${totalMemoryMB.toFixed(1)}MB fits in buffer, processing all ${numAngles} angles in single batch`);
    }
  }
  const allStripToolpaths = [];
  let totalToolpathPoints = 0;
  const pipelineStartTime = performance.now();
  const sparseToolData = createSparseToolFromPoints(toolData.positions);
  debug.log(`Created sparse tool: ${sparseToolData.count} points (reusing for all strips)`);
  let batchReuseBuffers = null;
  let batchTracking = [];
  for (let batchIdx = 0; batchIdx < numBatches; batchIdx++) {
    const batchStartTime = performance.now();
    const startAngleIdx = batchIdx * ANGLES_PER_BATCH;
    const endAngleIdx = Math.min(startAngleIdx + ANGLES_PER_BATCH, numAngles);
    const batchNumAngles = endAngleIdx - startAngleIdx;
    const batchStartAngle = startAngleIdx * angleStep;
    const batchInfo = {
      from: startAngleIdx,
      to: endAngleIdx
    };
    batchTracking.push(batchInfo);
    debug.log(`Batch ${batchIdx + 1}/${numBatches}: angles ${startAngleIdx}-${endAngleIdx - 1} (${batchNumAngles} angles), startAngle=${batchStartAngle.toFixed(1)}\xB0`);
    const rasterStartTime = performance.now();
    const shouldReturnBuffers = batchIdx === 0 && numBatches > 1;
    const batchModelResult = await radialRasterize({
      triangles,
      bucketData,
      resolution,
      angleStep,
      numAngles: batchNumAngles,
      maxRadius,
      toolWidth,
      zFloor,
      bounds,
      startAngle: batchStartAngle,
      reusableBuffers: batchReuseBuffers,
      returnBuffersForReuse: shouldReturnBuffers,
      batchInfo
    });
    const rasterTime = performance.now() - rasterStartTime;
    if (batchIdx === 0 && batchModelResult.reusableBuffers) {
      batchReuseBuffers = batchModelResult.reusableBuffers;
    }
    let maxStripWidth = 0;
    let maxStripHeight = 0;
    for (const strip of batchModelResult.strips) {
      maxStripWidth = Math.max(maxStripWidth, strip.gridWidth);
      maxStripHeight = Math.max(maxStripHeight, strip.gridHeight);
    }
    const reusableBuffers = createReusableToolpathBuffers(maxStripWidth, maxStripHeight, sparseToolData, xStep, maxStripHeight);
    const toolpathStartTime = performance.now();
    for (let i = 0; i < batchModelResult.strips.length; i++) {
      const strip = batchModelResult.strips[i];
      const globalStripIdx = startAngleIdx + i;
      if (globalStripIdx % 10 === 0 || globalStripIdx === numAngles - 1) {
        const stripProgress = (globalStripIdx + 1) / numAngles * 98;
        self.postMessage({
          type: "toolpath-progress",
          data: {
            percent: Math.round(stripProgress),
            current: globalStripIdx + 1,
            total: numAngles,
            layer: globalStripIdx + 1
          }
        });
      }
      if (!strip.positions || strip.positions.length === 0) continue;
      if (diagnostic && (globalStripIdx === 0 || globalStripIdx === 360)) {
        debug.log(`4MPQU71S | Strip ${globalStripIdx} (${strip.angle.toFixed(1)}\xB0) INPUT terrain first 5 Z values: ${strip.positions.slice(0, 5).map((v) => v.toFixed(3)).join(",")}`);
      }
      const stripToolpathResult = await runToolpathComputeWithBuffers(
        strip.positions,
        strip.gridWidth,
        strip.gridHeight,
        xStep,
        strip.gridHeight,
        zFloor,
        reusableBuffers,
        pipelineStartTime
      );
      if (diagnostic && (globalStripIdx === 0 || globalStripIdx === 360)) {
        debug.log(`4MPQU71S | Strip ${globalStripIdx} (${strip.angle.toFixed(1)}\xB0) OUTPUT toolpath first 5 Z values: ${stripToolpathResult.pathData.slice(0, 5).map((v) => v.toFixed(3)).join(",")}`);
      }
      allStripToolpaths.push({
        angle: strip.angle,
        pathData: stripToolpathResult.pathData,
        numScanlines: stripToolpathResult.numScanlines,
        pointsPerLine: stripToolpathResult.pointsPerLine,
        terrainBounds: strip.bounds
      });
      totalToolpathPoints += stripToolpathResult.pathData.length;
    }
    const toolpathTime = performance.now() - toolpathStartTime;
    for (const strip of batchModelResult.strips) {
      strip.positions = null;
    }
    destroyReusableToolpathBuffers(reusableBuffers);
    const batchTotalTime = performance.now() - batchStartTime;
    Object.assign(batchInfo, {
      "prep": batchInfo.prep || 0,
      "stitch": batchInfo.stitch || 0,
      "raster": batchInfo.raster || 0,
      "paths": toolpathTime | 0,
      "strips": allStripToolpaths.length,
      "total": batchTotalTime | 0
    });
  }
  console.table(batchTracking);
  if (batchReuseBuffers) {
    batchReuseBuffers.triangleBuffer.destroy();
    batchReuseBuffers.triangleIndicesBuffer.destroy();
    debug.log(`Destroyed cached GPU buffers after all batches`);
  }
  const pipelineTotalTime = performance.now() - pipelineStartTime;
  debug.log(`Complete radial toolpath: ${allStripToolpaths.length} strips, ${totalToolpathPoints} total points in ${pipelineTotalTime.toFixed(0)}ms`);
  self.postMessage({
    type: "toolpath-progress",
    data: {
      percent: 100,
      current: numAngles,
      total: numAngles,
      layer: numAngles
    }
  });
  return {
    strips: allStripToolpaths,
    totalPoints: totalToolpathPoints,
    numStrips: allStripToolpaths.length
  };
}

// src/core/path-radial-v3.js
async function rotateTriangles({
  triangleBuffer,
  // GPU buffer with original triangles
  numTriangles,
  angle
  // Radians
}) {
  const rotatePipeline = cachedRadialV3RotatePipeline;
  if (!rotatePipeline) {
    throw new Error("Radial V3 pipelines not initialized");
  }
  const outputSize = numTriangles * 11 * 4;
  const rotatedBuffer = device.createBuffer({
    size: outputSize,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
  });
  const uniformBuffer = device.createBuffer({
    size: 8,
    // f32 angle + u32 num_triangles
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    mappedAtCreation: true
  });
  const uniformView = new ArrayBuffer(8);
  const floatView = new Float32Array(uniformView);
  const uintView = new Uint32Array(uniformView);
  floatView[0] = angle;
  uintView[1] = numTriangles;
  new Uint8Array(uniformBuffer.getMappedRange()).set(new Uint8Array(uniformView));
  uniformBuffer.unmap();
  const bindGroup = device.createBindGroup({
    layout: rotatePipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: triangleBuffer } },
      { binding: 1, resource: { buffer: rotatedBuffer } },
      { binding: 2, resource: { buffer: uniformBuffer } }
    ]
  });
  const commandEncoder = device.createCommandEncoder();
  const passEncoder = commandEncoder.beginComputePass();
  passEncoder.setPipeline(rotatePipeline);
  passEncoder.setBindGroup(0, bindGroup);
  passEncoder.dispatchWorkgroups(Math.ceil(numTriangles / 64));
  passEncoder.end();
  device.queue.submit([commandEncoder.finish()]);
  uniformBuffer.destroy();
  return rotatedBuffer;
}
async function rasterizeAllBuckets({
  rotatedTrianglesBuffer,
  buckets,
  triangleIndices,
  resolution,
  toolRadius,
  fullGridWidth,
  gridHeight,
  globalMinX,
  bucketMinY,
  zFloor
}) {
  const rasterizePipeline = cachedRadialV3BatchedRasterizePipeline;
  if (!rasterizePipeline) {
    throw new Error("Radial V3 batched pipeline not initialized");
  }
  const bucketInfoSize = buckets.length * 16;
  const bucketInfoBuffer = device.createBuffer({
    size: bucketInfoSize,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    mappedAtCreation: true
  });
  const bucketView = new ArrayBuffer(bucketInfoSize);
  const bucketFloatView = new Float32Array(bucketView);
  const bucketUintView = new Uint32Array(bucketView);
  for (let i = 0; i < buckets.length; i++) {
    const bucket = buckets[i];
    const offset = i * 4;
    bucketFloatView[offset] = bucket.minX;
    bucketFloatView[offset + 1] = bucket.maxX;
    bucketUintView[offset + 2] = bucket.startIndex;
    bucketUintView[offset + 3] = bucket.count;
  }
  new Uint8Array(bucketInfoBuffer.getMappedRange()).set(new Uint8Array(bucketView));
  bucketInfoBuffer.unmap();
  const indicesBuffer = device.createBuffer({
    size: triangleIndices.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    mappedAtCreation: true
  });
  new Uint32Array(indicesBuffer.getMappedRange()).set(triangleIndices);
  indicesBuffer.unmap();
  const outputSize = fullGridWidth * gridHeight * 4;
  const outputBuffer = device.createBuffer({
    size: outputSize,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST
  });
  const initData = new Float32Array(fullGridWidth * gridHeight);
  initData.fill(zFloor);
  device.queue.writeBuffer(outputBuffer, 0, initData);
  const uniformBuffer = device.createBuffer({
    size: 32,
    // 8 fields × 4 bytes
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    mappedAtCreation: true
  });
  const uniformView = new ArrayBuffer(32);
  const floatView = new Float32Array(uniformView);
  const uintView = new Uint32Array(uniformView);
  floatView[0] = resolution;
  floatView[1] = toolRadius;
  uintView[2] = fullGridWidth;
  uintView[3] = gridHeight;
  floatView[4] = globalMinX;
  floatView[5] = bucketMinY;
  floatView[6] = zFloor;
  uintView[7] = buckets.length;
  new Uint8Array(uniformBuffer.getMappedRange()).set(new Uint8Array(uniformView));
  uniformBuffer.unmap();
  const bindGroup = device.createBindGroup({
    layout: rasterizePipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: rotatedTrianglesBuffer } },
      { binding: 1, resource: { buffer: outputBuffer } },
      { binding: 2, resource: { buffer: uniformBuffer } },
      { binding: 3, resource: { buffer: bucketInfoBuffer } },
      { binding: 4, resource: { buffer: indicesBuffer } }
    ]
  });
  const commandEncoder = device.createCommandEncoder();
  const passEncoder = commandEncoder.beginComputePass();
  passEncoder.setPipeline(rasterizePipeline);
  passEncoder.setBindGroup(0, bindGroup);
  const dispatchX = Math.ceil(fullGridWidth / 8);
  const dispatchY = Math.ceil(gridHeight / 8);
  passEncoder.dispatchWorkgroups(dispatchX, dispatchY);
  passEncoder.end();
  const stagingBuffer = device.createBuffer({
    size: outputSize,
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST
  });
  commandEncoder.copyBufferToBuffer(outputBuffer, 0, stagingBuffer, 0, outputSize);
  device.queue.submit([commandEncoder.finish()]);
  await device.queue.onSubmittedWorkDone();
  await stagingBuffer.mapAsync(GPUMapMode.READ);
  const terrainData = new Float32Array(stagingBuffer.getMappedRange().slice());
  stagingBuffer.unmap();
  outputBuffer.destroy();
  stagingBuffer.destroy();
  uniformBuffer.destroy();
  bucketInfoBuffer.destroy();
  indicesBuffer.destroy();
  return terrainData;
}
async function generateRadialToolpathsV3({
  triangles,
  bucketData,
  toolData,
  resolution,
  angleStep,
  numAngles,
  maxRadius,
  toolWidth,
  zFloor,
  bounds,
  xStep,
  yStep
}) {
  debug.log("radial-v3-generate-toolpaths", { triangles: triangles.length / 9, numAngles, resolution });
  const pipelineStartTime = performance.now();
  const allStripToolpaths = [];
  let totalToolpathPoints = 0;
  const sparseToolData = createSparseToolFromPoints(toolData.positions);
  debug.log(`Created sparse tool: ${sparseToolData.count} points (reusing for all strips)`);
  const toolRadius = toolWidth / 2;
  const bucketMinX = bucketData.buckets[0].minX;
  const bucketMaxX = bucketData.buckets[bucketData.numBuckets - 1].maxX;
  const fullWidth = bucketMaxX - bucketMinX;
  const fullGridWidth = Math.ceil(fullWidth / resolution);
  const gridHeight = Math.ceil(toolWidth / resolution);
  debug.log(`Uploading ${triangles.length / 9} triangles to GPU (reused across all angles)...`);
  const allTrianglesBuffer = device.createBuffer({
    size: triangles.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    mappedAtCreation: true
  });
  new Float32Array(allTrianglesBuffer.getMappedRange()).set(triangles);
  allTrianglesBuffer.unmap();
  for (let angleIdx = 0; angleIdx < numAngles; angleIdx++) {
    const angle = -(angleIdx * angleStep * (Math.PI / 180));
    const angleDegrees = angleIdx * angleStep;
    if (diagnostic) {
      debug.log(`Angle ${angleIdx + 1}/${numAngles}: ${angleDegrees.toFixed(1)}\xB0`);
    }
    if (angleIdx % 10 === 0 || angleIdx === numAngles - 1) {
      const stripProgress = (angleIdx + 1) / numAngles * 98;
      self.postMessage({
        type: "toolpath-progress",
        data: {
          percent: Math.round(stripProgress),
          current: angleIdx + 1,
          total: numAngles,
          layer: angleIdx + 1
        }
      });
    }
    const numTotalTriangles = triangles.length / 9;
    const allRotatedTrianglesBuffer = await rotateTriangles({
      triangleBuffer: allTrianglesBuffer,
      numTriangles: numTotalTriangles,
      angle
    });
    const fullTerrainStrip = await rasterizeAllBuckets({
      rotatedTrianglesBuffer: allRotatedTrianglesBuffer,
      buckets: bucketData.buckets,
      triangleIndices: bucketData.triangleIndices,
      resolution,
      toolRadius,
      fullGridWidth,
      gridHeight,
      globalMinX: bucketMinX,
      bucketMinY: -toolWidth / 2,
      zFloor
    });
    allRotatedTrianglesBuffer.destroy();
    const reusableToolpathBuffers = createReusableToolpathBuffers(
      fullGridWidth,
      gridHeight,
      sparseToolData,
      xStep,
      gridHeight
    );
    const stripToolpathResult = await runToolpathComputeWithBuffers(
      fullTerrainStrip,
      fullGridWidth,
      gridHeight,
      xStep,
      gridHeight,
      zFloor,
      reusableToolpathBuffers,
      pipelineStartTime
    );
    destroyReusableToolpathBuffers(reusableToolpathBuffers);
    allStripToolpaths.push({
      angle: angleDegrees,
      pathData: stripToolpathResult.pathData,
      numScanlines: stripToolpathResult.numScanlines,
      pointsPerLine: stripToolpathResult.pointsPerLine,
      terrainBounds: {
        min: { x: bucketMinX, y: -toolWidth / 2, z: zFloor },
        max: { x: bucketMaxX, y: toolWidth / 2, z: bounds.max.z }
      }
    });
    totalToolpathPoints += stripToolpathResult.pathData.length;
  }
  allTrianglesBuffer.destroy();
  debug.log(`Destroyed reusable triangle buffer`);
  const pipelineTotalTime = performance.now() - pipelineStartTime;
  debug.log(`Complete radial V3 toolpath: ${allStripToolpaths.length} strips, ${totalToolpathPoints} total points in ${pipelineTotalTime.toFixed(0)}ms`);
  self.postMessage({
    type: "toolpath-progress",
    data: {
      percent: 100,
      current: bucketData.numBuckets * numAngles,
      total: bucketData.numBuckets * numAngles,
      layer: numAngles
    }
  });
  return {
    strips: allStripToolpaths,
    totalPoints: totalToolpathPoints,
    numStrips: allStripToolpaths.length
  };
}

// src/core/path-tracing.js
var cachedTracingBuffers = null;
function createReusableTracingBuffers(terrainPositions, toolPositions) {
  if (!isInitialized) {
    throw new Error("WebGPU not initialized");
  }
  if (cachedTracingBuffers) {
    destroyReusableTracingBuffers();
  }
  const sparseToolData = createSparseToolFromPoints(toolPositions);
  debug.log(`Created reusable tracing buffers: terrain ${terrainPositions.length} floats, tool ${sparseToolData.count} points`);
  const terrainBuffer = device.createBuffer({
    size: terrainPositions.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
  });
  device.queue.writeBuffer(terrainBuffer, 0, terrainPositions);
  const toolBufferData = new ArrayBuffer(sparseToolData.count * 16);
  const toolBufferI32 = new Int32Array(toolBufferData);
  const toolBufferF32 = new Float32Array(toolBufferData);
  for (let i = 0; i < sparseToolData.count; i++) {
    toolBufferI32[i * 4 + 0] = sparseToolData.xOffsets[i];
    toolBufferI32[i * 4 + 1] = sparseToolData.yOffsets[i];
    toolBufferF32[i * 4 + 2] = sparseToolData.zValues[i];
    toolBufferF32[i * 4 + 3] = 0;
  }
  const toolBuffer = device.createBuffer({
    size: toolBufferData.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
  });
  device.queue.writeBuffer(toolBuffer, 0, toolBufferData);
  cachedTracingBuffers = {
    terrainBuffer,
    toolBuffer,
    sparseToolData
  };
  return cachedTracingBuffers;
}
function destroyReusableTracingBuffers() {
  if (cachedTracingBuffers) {
    cachedTracingBuffers.terrainBuffer.destroy();
    cachedTracingBuffers.toolBuffer.destroy();
    cachedTracingBuffers = null;
    debug.log("Destroyed reusable tracing buffers");
  }
}
function samplePath(pathXY, step) {
  if (pathXY.length < 2) {
    return new Float32Array(pathXY);
  }
  const numVertices = pathXY.length / 2;
  const sampledPoints = [];
  sampledPoints.push(pathXY[0], pathXY[1]);
  for (let i = 0; i < numVertices - 1; i++) {
    const x1 = pathXY[i * 2];
    const y1 = pathXY[i * 2 + 1];
    const x2 = pathXY[(i + 1) * 2];
    const y2 = pathXY[(i + 1) * 2 + 1];
    const dx = x2 - x1;
    const dy = y2 - y1;
    const segmentLength = Math.sqrt(dx * dx + dy * dy);
    if (segmentLength > step) {
      const numSubdivisions = Math.ceil(segmentLength / step);
      const subdivisionStep = 1 / numSubdivisions;
      for (let j = 1; j < numSubdivisions; j++) {
        const t = j * subdivisionStep;
        const x = x1 + t * dx;
        const y = y1 + t * dy;
        sampledPoints.push(x, y);
      }
    }
    if (i < numVertices - 1) {
      sampledPoints.push(x2, y2);
    }
  }
  return new Float32Array(sampledPoints);
}
async function generateTracingToolpaths({
  paths,
  terrainPositions,
  terrainData,
  toolPositions,
  step,
  gridStep,
  terrainBounds,
  zFloor,
  onProgress
}) {
  const startTime = performance.now();
  debug.log("Generating tracing toolpaths...");
  debug.log(`Input: ${paths.length} paths, step=${step}, gridStep=${gridStep}, zFloor=${zFloor}`);
  debug.log(`Terrain: ${terrainData.width}\xD7${terrainData.height}, bounds: min(${terrainBounds.min.x.toFixed(2)}, ${terrainBounds.min.y.toFixed(2)}) max(${terrainBounds.max.x.toFixed(2)}, ${terrainBounds.max.y.toFixed(2)})`);
  if (!isInitialized) {
    const success = await initWebGPU();
    if (!success) {
      throw new Error("WebGPU not available");
    }
  }
  let terrainBuffer, toolBuffer, sparseToolData;
  let shouldCleanupBuffers = false;
  if (cachedTracingBuffers) {
    debug.log("Using cached tracing buffers");
    terrainBuffer = cachedTracingBuffers.terrainBuffer;
    toolBuffer = cachedTracingBuffers.toolBuffer;
    sparseToolData = cachedTracingBuffers.sparseToolData;
  } else {
    debug.log("Creating temporary tracing buffers");
    sparseToolData = createSparseToolFromPoints(toolPositions);
    debug.log(`Created sparse tool: ${sparseToolData.count} points`);
    terrainBuffer = device.createBuffer({
      size: terrainPositions.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });
    device.queue.writeBuffer(terrainBuffer, 0, terrainPositions);
    const toolBufferData = new ArrayBuffer(sparseToolData.count * 16);
    const toolBufferI32 = new Int32Array(toolBufferData);
    const toolBufferF32 = new Float32Array(toolBufferData);
    for (let i = 0; i < sparseToolData.count; i++) {
      toolBufferI32[i * 4 + 0] = sparseToolData.xOffsets[i];
      toolBufferI32[i * 4 + 1] = sparseToolData.yOffsets[i];
      toolBufferF32[i * 4 + 2] = sparseToolData.zValues[i];
      toolBufferF32[i * 4 + 3] = 0;
    }
    toolBuffer = device.createBuffer({
      size: toolBufferData.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });
    device.queue.writeBuffer(toolBuffer, 0, toolBufferData);
    await device.queue.onSubmittedWorkDone();
    shouldCleanupBuffers = true;
  }
  const SENTINEL_Z = -1e30;
  const sentinelBits = new Float32Array([SENTINEL_Z]);
  const sentinelI32 = new Int32Array(sentinelBits.buffer)[0];
  const maxZInitData = new Int32Array(paths.length).fill(sentinelI32);
  const maxZBuffer = device.createBuffer({
    size: maxZInitData.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
  });
  device.queue.writeBuffer(maxZBuffer, 0, maxZInitData);
  debug.log("PHASE 1: Sampling all paths...");
  const pathIndex = [];
  const sampledSegments = [];
  let totalSampledPoints = 0;
  for (let pathIdx = 0; pathIdx < paths.length; pathIdx++) {
    const inputPath = paths[pathIdx];
    debug.log(`Path ${pathIdx + 1}/${paths.length}: ${inputPath.length / 2} input vertices`);
    const sampledPath = samplePath(inputPath, step);
    const numPoints = sampledPath.length / 2;
    pathIndex.push({
      startOffset: totalSampledPoints,
      endOffset: totalSampledPoints + numPoints,
      numPoints
    });
    sampledSegments.push(sampledPath);
    totalSampledPoints += numPoints;
    debug.log(`  Sampled to ${numPoints} points`);
  }
  const unifiedSampledXY = new Float32Array(totalSampledPoints * 2);
  let writeOffset = 0;
  for (let pathIdx = 0; pathIdx < sampledSegments.length; pathIdx++) {
    const sampledPath = sampledSegments[pathIdx];
    unifiedSampledXY.set(sampledPath, writeOffset * 2);
    writeOffset += sampledPath.length / 2;
  }
  debug.log(`Unified buffer: ${totalSampledPoints} total points from ${paths.length} paths`);
  if (totalSampledPoints > 0) {
    const firstX = unifiedSampledXY[0];
    const firstY = unifiedSampledXY[1];
    const gridX = (firstX - terrainBounds.min.x) / gridStep;
    const gridY = (firstY - terrainBounds.min.y) / gridStep;
    debug.log(`First point: world(${firstX.toFixed(2)}, ${firstY.toFixed(2)}) -> grid(${gridX.toFixed(2)}, ${gridY.toFixed(2)})`);
  }
  debug.log("PHASE 2: Calculating memory budget and chunking...");
  const bytesPerPoint = 8 + 4 + 4;
  const configuredLimit = config.maxGPUMemoryMB * 1024 * 1024;
  const deviceLimit = deviceCapabilities.maxStorageBufferBindingSize;
  const maxSafeSize = Math.min(configuredLimit, deviceLimit) * config.gpuMemorySafetyMargin;
  const fixedOverhead = terrainPositions.byteLength + sparseToolData.count * 16 + paths.length * 4 + 48;
  if (fixedOverhead > maxSafeSize) {
    if (shouldCleanupBuffers) {
      terrainBuffer.destroy();
      toolBuffer.destroy();
    }
    throw new Error(
      `Fixed buffers (terrain + tool) exceed GPU memory: ${(fixedOverhead / 1024 / 1024).toFixed(1)}MB > ${(maxSafeSize / 1024 / 1024).toFixed(1)}MB. Try reducing terrain resolution or tool density.`
    );
  }
  const availableForPaths = maxSafeSize - fixedOverhead;
  const maxPointsPerChunkMemory = Math.floor(availableForPaths / bytesPerPoint);
  const maxWorkgroupsPerDimension = deviceCapabilities.maxComputeWorkgroupsPerDimension || 65535;
  const threadsPerWorkgroup = 64;
  const maxPointsPerChunkGPU = maxWorkgroupsPerDimension * threadsPerWorkgroup;
  const maxPointsPerChunk = Math.min(maxPointsPerChunkMemory, maxPointsPerChunkGPU);
  debug.log(`Memory budget: ${(maxSafeSize / 1024 / 1024).toFixed(1)}MB safe, ${(availableForPaths / 1024 / 1024).toFixed(1)}MB available for paths`);
  debug.log(`Memory-based max: ${maxPointsPerChunkMemory.toLocaleString()} points`);
  debug.log(`GPU dispatch max: ${maxPointsPerChunkGPU.toLocaleString()} points (${maxWorkgroupsPerDimension.toLocaleString()} workgroups)`);
  debug.log(`Max points per chunk: ${maxPointsPerChunk.toLocaleString()} (limited by ${maxPointsPerChunk === maxPointsPerChunkGPU ? "GPU" : "memory"})`);
  const chunks = [];
  let currentStart = 0;
  while (currentStart < totalSampledPoints) {
    const currentEnd = Math.min(currentStart + maxPointsPerChunk, totalSampledPoints);
    chunks.push({
      startPoint: currentStart,
      endPoint: currentEnd,
      numPoints: currentEnd - currentStart
    });
    currentStart = currentEnd;
  }
  debug.log(`Created ${chunks.length} chunk(s) for processing`);
  debug.log("PHASE 3: Creating reusable GPU buffers...");
  const inputBuffer = device.createBuffer({
    size: maxPointsPerChunk * 8,
    // 2 floats per point
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
  });
  const outputBuffer = device.createBuffer({
    size: maxPointsPerChunk * 4,
    // 1 float per point
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
  });
  const uniformBuffer = device.createBuffer({
    size: 48,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
  });
  const stagingBuffer = device.createBuffer({
    size: maxPointsPerChunk * 4,
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST
  });
  const unifiedOutputZ = new Float32Array(totalSampledPoints);
  debug.log(`Buffers created for ${maxPointsPerChunk.toLocaleString()} points per chunk`);
  debug.log("PHASE 4: Processing chunks...");
  for (let chunkIdx = 0; chunkIdx < chunks.length; chunkIdx++) {
    const chunk = chunks[chunkIdx];
    const { startPoint, endPoint, numPoints } = chunk;
    debug.log(`Processing chunk ${chunkIdx + 1}/${chunks.length}: points ${startPoint}-${endPoint} (${numPoints} points)`);
    const chunkInputXY = unifiedSampledXY.subarray(startPoint * 2, endPoint * 2);
    device.queue.writeBuffer(inputBuffer, 0, chunkInputXY);
    const uniformData = new Uint32Array(12);
    uniformData[0] = terrainData.width;
    uniformData[1] = terrainData.height;
    uniformData[2] = sparseToolData.count;
    uniformData[3] = numPoints;
    uniformData[4] = 0;
    const uniformDataFloat = new Float32Array(uniformData.buffer);
    uniformDataFloat[5] = terrainBounds.min.x;
    uniformDataFloat[6] = terrainBounds.min.y;
    uniformDataFloat[7] = gridStep;
    uniformDataFloat[8] = zFloor;
    device.queue.writeBuffer(uniformBuffer, 0, uniformData);
    await device.queue.onSubmittedWorkDone();
    const bindGroup = device.createBindGroup({
      layout: cachedTracingPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: terrainBuffer } },
        { binding: 1, resource: { buffer: toolBuffer } },
        { binding: 2, resource: { buffer: inputBuffer } },
        { binding: 3, resource: { buffer: outputBuffer } },
        { binding: 4, resource: { buffer: maxZBuffer } },
        // Keep for shader compatibility
        { binding: 5, resource: { buffer: uniformBuffer } }
      ]
    });
    const commandEncoder = device.createCommandEncoder();
    const passEncoder = commandEncoder.beginComputePass();
    passEncoder.setPipeline(cachedTracingPipeline);
    passEncoder.setBindGroup(0, bindGroup);
    const workgroupsX = Math.ceil(numPoints / 64);
    passEncoder.dispatchWorkgroups(workgroupsX);
    passEncoder.end();
    commandEncoder.copyBufferToBuffer(outputBuffer, 0, stagingBuffer, 0, numPoints * 4);
    device.queue.submit([commandEncoder.finish()]);
    await device.queue.onSubmittedWorkDone();
    await stagingBuffer.mapAsync(GPUMapMode.READ);
    const chunkOutputZ = new Float32Array(stagingBuffer.getMappedRange(), 0, numPoints);
    unifiedOutputZ.set(chunkOutputZ, startPoint);
    stagingBuffer.unmap();
    debug.log(`  Chunk ${chunkIdx + 1} complete: ${numPoints} points processed`);
    if (onProgress) {
      onProgress({
        type: "tracing-progress",
        data: {
          percent: Math.round(endPoint / totalSampledPoints * 100),
          current: endPoint,
          total: totalSampledPoints,
          chunkIndex: chunkIdx + 1,
          totalChunks: chunks.length
        }
      });
    }
  }
  inputBuffer.destroy();
  outputBuffer.destroy();
  uniformBuffer.destroy();
  stagingBuffer.destroy();
  debug.log("All chunks processed");
  debug.log("PHASE 5: Remapping to individual paths and computing maxZ...");
  const outputPaths = [];
  const maxZValues = new Array(paths.length).fill(zFloor);
  for (let pathIdx = 0; pathIdx < pathIndex.length; pathIdx++) {
    const { startOffset, numPoints } = pathIndex[pathIdx];
    if (numPoints === 0) {
      outputPaths.push(new Float32Array(0));
      debug.log(`Path ${pathIdx + 1}: empty`);
      continue;
    }
    const pathXYZ = new Float32Array(numPoints * 3);
    for (let i = 0; i < numPoints; i++) {
      const unifiedIdx = startOffset + i;
      const x = unifiedSampledXY[unifiedIdx * 2 + 0];
      const y = unifiedSampledXY[unifiedIdx * 2 + 1];
      const z = unifiedOutputZ[unifiedIdx];
      pathXYZ[i * 3 + 0] = x;
      pathXYZ[i * 3 + 1] = y;
      pathXYZ[i * 3 + 2] = z;
      maxZValues[pathIdx] = Math.max(maxZValues[pathIdx], z);
    }
    outputPaths.push(pathXYZ);
    debug.log(`Path ${pathIdx + 1}: ${numPoints} points, maxZ=${maxZValues[pathIdx].toFixed(2)}`);
  }
  maxZBuffer.destroy();
  if (shouldCleanupBuffers) {
    terrainBuffer.destroy();
    toolBuffer.destroy();
    debug.log("Cleaned up temporary tracing buffers");
  }
  const endTime = performance.now();
  debug.log(`Tracing complete: ${paths.length} paths, ${totalSampledPoints} total points in ${(endTime - startTime).toFixed(1)}ms`);
  debug.log(`Max Z values: [${Array.from(maxZValues).map((z) => z.toFixed(2)).join(", ")}]`);
  return {
    paths: outputPaths,
    maxZ: Array.from(maxZValues),
    generationTime: endTime - startTime
  };
}

// src/core/workload-calibrate.js
var calibrateShaderCode = `// Workload Calibration Shader
// Tests GPU watchdog limits by doing configurable amount of work per thread

struct Uniforms {
    workgroup_size_x: u32,
    workgroup_size_y: u32,
    workgroup_size_z: u32,
    triangle_tests: u32,  // How many intersection tests to run
}

@group(0) @binding(0) var<storage, read_write> completion_flags: array<u32>;
@group(0) @binding(1) var<uniform> uniforms: Uniforms;

// Ray-triangle intersection using Möller-Trumbore algorithm
// This is the actual production code - same ALU/cache characteristics
fn ray_triangle_intersect(
    ray_origin: vec3<f32>,
    ray_dir: vec3<f32>,
    v0: vec3<f32>,
    v1: vec3<f32>,
    v2: vec3<f32>
) -> vec2<f32> {  // Returns (hit: 0.0 or 1.0, z: intersection_z)
    let EPSILON = 0.0001;

    // Calculate edges
    let edge1 = v1 - v0;
    let edge2 = v2 - v0;

    // Cross product: ray_dir × edge2
    let h = cross(ray_dir, edge2);

    // Dot product: edge1 · h
    let a = dot(edge1, h);

    // Check if ray is parallel to triangle
    if (abs(a) < EPSILON) {
        return vec2<f32>(0.0, 0.0);
    }

    let f = 1.0 / a;
    let s = ray_origin - v0;
    let u = f * dot(s, h);

    // Check if intersection is outside triangle (u parameter)
    if (u < 0.0 || u > 1.0) {
        return vec2<f32>(0.0, 0.0);
    }

    let q = cross(s, edge1);
    let v = f * dot(ray_dir, q);

    // Check if intersection is outside triangle (v parameter)
    if (v < 0.0 || u + v > 1.0) {
        return vec2<f32>(0.0, 0.0);
    }

    // Calculate intersection point along ray
    let t = f * dot(edge2, q);

    if (t > EPSILON) {
        // Ray hit triangle
        let intersection_z = ray_origin.z + t * ray_dir.z;
        return vec2<f32>(1.0, intersection_z);
    }

    return vec2<f32>(0.0, 0.0);
}

@compute @workgroup_size(16, 16, 1)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let thread_index = global_id.z * (uniforms.workgroup_size_x * uniforms.workgroup_size_y) +
                       global_id.y * uniforms.workgroup_size_x +
                       global_id.x;

    // Synthetic triangle vertices (deterministic, no memory reads needed)
    let v0 = vec3<f32>(0.0, 0.0, 0.0);
    let v1 = vec3<f32>(1.0, 0.0, 0.0);
    let v2 = vec3<f32>(0.5, 1.0, 0.0);

    // Ray parameters based on thread ID (deterministic)
    let ray_origin = vec3<f32>(
        f32(global_id.x) * 0.1,
        f32(global_id.y) * 0.1,
        10.0
    );
    let ray_dir = vec3<f32>(0.0, 0.0, -1.0);

    // Perform N intersection tests (configurable workload)
    var hit_count = 0u;
    for (var i = 0u; i < uniforms.triangle_tests; i++) {
        // Slightly vary triangle vertices to prevent compiler optimization
        let offset = f32(i) * 0.001;
        let v0_offset = v0 + vec3<f32>(offset, 0.0, 0.0);
        let v1_offset = v1 + vec3<f32>(0.0, offset, 0.0);
        let v2_offset = v2 + vec3<f32>(offset, offset, 0.0);

        let result = ray_triangle_intersect(ray_origin, ray_dir, v0_offset, v1_offset, v2_offset);
        if (result.x > 0.5) {
            hit_count += 1u;
        }
    }

    // Write completion flag (1 = thread completed all work)
    // If this thread was killed by watchdog, this write never happens (stays 0)
    completion_flags[thread_index] = 1u;
}
`;
async function testWorkload(device2, pipeline, workgroupSize, triangleTests) {
  const [x, y, z] = workgroupSize;
  const totalThreads = x * y * z;
  const completionBuffer = device2.createBuffer({
    size: totalThreads * 4,
    // u32 per thread
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST
  });
  const zeroData = new Uint32Array(totalThreads);
  device2.queue.writeBuffer(completionBuffer, 0, zeroData);
  const uniformData = new Uint32Array([x, y, z, triangleTests]);
  const uniformBuffer = device2.createBuffer({
    size: uniformData.byteLength,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
  });
  device2.queue.writeBuffer(uniformBuffer, 0, uniformData);
  await device2.queue.onSubmittedWorkDone();
  const bindGroup = device2.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: completionBuffer } },
      { binding: 1, resource: { buffer: uniformBuffer } }
    ]
  });
  const startTime = performance.now();
  const commandEncoder = device2.createCommandEncoder();
  const passEncoder = commandEncoder.beginComputePass();
  passEncoder.setPipeline(pipeline);
  passEncoder.setBindGroup(0, bindGroup);
  passEncoder.dispatchWorkgroups(1, 1, 1);
  passEncoder.end();
  const stagingBuffer = device2.createBuffer({
    size: totalThreads * 4,
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST
  });
  commandEncoder.copyBufferToBuffer(completionBuffer, 0, stagingBuffer, 0, totalThreads * 4);
  device2.queue.submit([commandEncoder.finish()]);
  await device2.queue.onSubmittedWorkDone();
  const elapsed = performance.now() - startTime;
  await stagingBuffer.mapAsync(GPUMapMode.READ);
  const completionData = new Uint32Array(stagingBuffer.getMappedRange());
  const completionCopy = new Uint32Array(completionData);
  stagingBuffer.unmap();
  let failedThreads = 0;
  for (let i = 0; i < totalThreads; i++) {
    if (completionCopy[i] === 0) {
      failedThreads++;
    }
  }
  completionBuffer.destroy();
  uniformBuffer.destroy();
  stagingBuffer.destroy();
  return {
    success: failedThreads === 0,
    failedThreads,
    totalThreads,
    elapsed
  };
}
async function findMaxWork(device2, pipeline, workgroupSize, minWork, maxWork) {
  let low = minWork;
  let high = maxWork;
  let lastSuccess = minWork;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const result = await testWorkload(device2, pipeline, workgroupSize, mid);
    if (result.success) {
      lastSuccess = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return lastSuccess;
}
async function calibrateGPU(device2, options = {}) {
  const {
    workgroupSizes = [
      [8, 8, 1],
      [16, 16, 1],
      [32, 32, 1],
      [64, 64, 1]
    ],
    minWork = 1e3,
    maxWork = 1e5,
    verbose = true
  } = options;
  const shaderModule = device2.createShaderModule({ code: calibrateShaderCode });
  const pipeline = device2.createComputePipeline({
    layout: "auto",
    compute: { module: shaderModule, entryPoint: "main" }
  });
  const results = [];
  if (verbose) {
    console.log("[Calibrate] Starting GPU calibration...");
    console.log("[Calibrate] Testing workgroup sizes:", workgroupSizes);
  }
  for (const size of workgroupSizes) {
    const [x, y, z] = size;
    const totalThreads = x * y * z;
    if (verbose) {
      console.log(`[Calibrate] Testing ${x}x${y}x${z} (${totalThreads} threads)...`);
    }
    const minTest = await testWorkload(device2, pipeline, size, minWork);
    if (!minTest.success) {
      if (verbose) {
        console.log(`[Calibrate]   \u274C Failed even at minimum work (${minWork} tests)`);
      }
      break;
    }
    const maxWorkFound = await findMaxWork(device2, pipeline, size, minWork, maxWork);
    const finalTest = await testWorkload(device2, pipeline, size, maxWorkFound);
    results.push({
      workgroupSize: size,
      totalThreads,
      maxWork: maxWorkFound,
      timingMs: finalTest.elapsed,
      msPerThread: finalTest.elapsed / totalThreads,
      testsPerSecond: maxWorkFound * totalThreads / (finalTest.elapsed / 1e3)
    });
    if (verbose) {
      console.log(`[Calibrate]   \u2713 Max work: ${maxWorkFound} tests (${finalTest.elapsed.toFixed(1)}ms)`);
      console.log(`[Calibrate]     ${(maxWorkFound * totalThreads).toLocaleString()} total ray-triangle tests`);
    }
  }
  const maxWorkgroupResult = results[results.length - 1];
  const minWorkPerThread = Math.min(...results.map((r) => r.maxWork));
  const calibration = {
    maxWorkgroupSize: maxWorkgroupResult.workgroupSize,
    maxWorkPerThread: minWorkPerThread,
    // Conservative: min across all sizes
    safeWorkloadMatrix: results,
    deviceInfo: {
      maxComputeWorkgroupSizeX: device2.limits.maxComputeWorkgroupSizeX,
      maxComputeWorkgroupSizeY: device2.limits.maxComputeWorkgroupSizeY,
      maxComputeWorkgroupSizeZ: device2.limits.maxComputeWorkgroupSizeZ,
      maxComputeWorkgroupsPerDimension: device2.limits.maxComputeWorkgroupsPerDimension
    }
  };
  if (verbose) {
    console.log("[Calibrate] Calibration complete:");
    console.log(`[Calibrate]   Max safe workgroup: ${maxWorkgroupResult.workgroupSize.join("x")}`);
    console.log(`[Calibrate]   Max work per thread: ${minWorkPerThread.toLocaleString()}`);
  }
  return calibration;
}

// src/core/raster-worker.js
self.addEventListener("error", (event) => {
  debug.error("Uncaught error:", event.error || event.message);
  debug.error("Stack:", event.error?.stack);
});
self.addEventListener("unhandledrejection", (event) => {
  debug.error("Unhandled promise rejection:", event.reason);
});
self.onmessage = async function(e) {
  const { type, data } = e.data;
  try {
    switch (type) {
      case "init":
        setConfig(data?.config || {
          maxGPUMemoryMB: 256,
          gpuMemorySafetyMargin: 0.8,
          tileOverlapMM: 10,
          autoTiling: true,
          batchDivisor: 1,
          // For testing batching overhead: 1=optimal, 2=2x batches, 4=4x batches, etc.
          maxConcurrentThreads: 32768
          // GPU watchdog limit: max threads across all workgroups in a dispatch
        });
        const success = await initWebGPU();
        self.postMessage({
          type: "webgpu-ready",
          data: {
            success,
            capabilities: deviceCapabilities
          }
        });
        break;
      case "update-config":
        updateConfig(data.config);
        debug.log("Config updated");
        break;
      case "rasterize":
        const { triangles, stepSize, filterMode, boundsOverride } = data;
        const rasterOptions = boundsOverride || {};
        const rasterResult = await rasterizeMesh(triangles, stepSize, filterMode, rasterOptions);
        self.postMessage({
          type: "rasterize-complete",
          data: rasterResult
        }, [rasterResult.positions.buffer]);
        break;
      case "generate-toolpath":
        const { terrainPositions, toolPositions, xStep, yStep, zFloor, gridStep, terrainBounds, singleScanline } = data;
        const toolpathResult = await generateToolpath(
          terrainPositions,
          toolPositions,
          xStep,
          yStep,
          zFloor,
          gridStep,
          terrainBounds,
          singleScanline
        );
        self.postMessage({
          type: "toolpath-complete",
          data: toolpathResult
        }, [toolpathResult.pathData.buffer]);
        break;
      case "radial-generate-toolpaths":
        const radialToolpathResult = await generateRadialToolpaths(data);
        const toolpathTransferBuffers = radialToolpathResult.strips.map((strip) => strip.pathData.buffer);
        self.postMessage({
          type: "radial-toolpaths-complete",
          data: radialToolpathResult
        }, toolpathTransferBuffers);
        break;
      case "radial-generate-toolpaths-v3":
        const radialV3ToolpathResult = await generateRadialToolpathsV3(data);
        const v3ToolpathTransferBuffers = radialV3ToolpathResult.strips.map((strip) => strip.pathData.buffer);
        self.postMessage({
          type: "radial-toolpaths-complete",
          data: radialV3ToolpathResult
        }, v3ToolpathTransferBuffers);
        break;
      case "tracing-generate-toolpaths":
        const tracingResult = await generateTracingToolpaths({
          paths: data.paths,
          terrainPositions: data.terrainPositions,
          terrainData: data.terrainData,
          toolPositions: data.toolPositions,
          step: data.step,
          gridStep: data.gridStep,
          terrainBounds: data.terrainBounds,
          zFloor: data.zFloor,
          onProgress: (progressData) => {
            self.postMessage({
              type: "tracing-progress",
              data: progressData.data
            });
          }
        });
        const tracingTransferBuffers = tracingResult.paths.map((p) => p.buffer);
        self.postMessage({
          type: "tracing-toolpaths-complete",
          data: tracingResult
        }, tracingTransferBuffers);
        break;
      case "create-tracing-buffers":
        createReusableTracingBuffers(data.terrainPositions, data.toolPositions);
        self.postMessage({
          type: "tracing-buffers-created",
          data: { success: true }
        });
        break;
      case "destroy-tracing-buffers":
        destroyReusableTracingBuffers();
        self.postMessage({
          type: "tracing-buffers-destroyed",
          data: { success: true }
        });
        break;
      case "calibrate":
        const calibrationResult = await calibrateGPU(device, data?.options || {});
        self.postMessage({
          type: "calibrate-complete",
          data: calibrationResult
        });
        break;
      default:
        self.postMessage({
          type: "error",
          message: "Unknown message type: " + type
        });
    }
  } catch (error) {
    debug.error("Error:", error);
    self.postMessage({
      type: "error",
      message: error.message,
      stack: error.stack
    });
  }
};
