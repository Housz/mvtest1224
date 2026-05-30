import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { State } from '../state.js';
import { getHeatmapColor } from '../utils.js';
import { calculateNetworkValues, calculateAirflowField } from '../algorithms.js';
import {
    addFacilityToBranch,
    FacilityVisuals,
    colorForValue,
    currentAirflowByBranch,
    ensureVentilationNetwork,
    facilityPlacement,
    generateAirflowState,
    ratioAtPointOnBranch,
    selectBranch,
    selectFacility,
    valueRange
} from '../ventilation.js';

let scene, camera, renderer, controls;
let rootGroup, sensorGroup, linesGroup, axesHelper, vectorGroup, ventilationGroup;
let raycaster = new THREE.Raycaster(), mouse = new THREE.Vector2();
let isWireframe = false;
const matNormal = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true });

export function init3D(viewportEl, uiCallback) {
    scene = new THREE.Scene(); 
    // scene.background = new THREE.Color(0x000000);
    scene.background = new THREE.Color(0xffffff);
    camera = new THREE.PerspectiveCamera(45, viewportEl.clientWidth / viewportEl.clientHeight, 0.1, 50000);
    camera.position.set(0, 0, 1000);
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(viewportEl.clientWidth, viewportEl.clientHeight);
    viewportEl.appendChild(renderer.domElement);
    
    const dirLight = new THREE.DirectionalLight(0xffffff, 1); dirLight.position.set(100, -200, 300); scene.add(dirLight);
    scene.add(new THREE.AmbientLight(0x666666, 1.5));

    rootGroup = new THREE.Group(); scene.add(rootGroup);
    sensorGroup = new THREE.Group(); scene.add(sensorGroup);
    linesGroup = new THREE.Group(); linesGroup.visible = false; scene.add(linesGroup);
    vectorGroup = new THREE.Group(); scene.add(vectorGroup);
    ventilationGroup = new THREE.Group(); scene.add(ventilationGroup);
    
    axesHelper = new THREE.AxesHelper(500); axesHelper.visible = false; scene.add(axesHelper);
    
    controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true;
    window.addEventListener('resize', () => {
        if(viewportEl) { camera.aspect = viewportEl.clientWidth / viewportEl.clientHeight; camera.updateProjectionMatrix(); renderer.setSize(viewportEl.clientWidth, viewportEl.clientHeight); }
    });

    const raycastFromEvent = (e) => {
        const rect = renderer.domElement.getBoundingClientRect();
        mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(mouse, camera);
        const pickObjects = [
            ...(State.isEnvironmentalMode() ? sensorGroup.children : []),
            ...(State.isVentilationMode() ? ventilationGroup.children : []),
            ...rootGroup.children
        ];
        return raycaster.intersectObjects(pickObjects, true);
    };

    renderer.domElement.addEventListener('click', (e) => {
        const intersects = raycastFromEvent(e);
        if (intersects.length > 0) {
            const ud = intersects[0].object.userData;
            if (ud && ud.data) {
                if (ud.type === 'Sensor') State.selectedEntity = { type: 'Sensor', data: ud.data, index: -1 };
                else if (ud.type === 'VentilationFacility') selectFacility(ud.data.id);
                else if (ud.type === 'VentilationBranch') selectBranch(ud.data.id);
                else State.selectedEntity = { type: ud.type, data: ud.data, index: ud.index };
                uiCallback(); highlight();
            }
        }
    });
    renderer.domElement.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (!State.isVentilationMode()) return;
        const hit = raycastFromEvent(e).find((item) => item.object.userData?.type === 'VentilationBranch');
        const branch = hit?.object.userData?.data;
        if (!branch) return;
        const type = document.getElementById('vent-facility-type')?.value || 'fan';
        addFacilityToBranch(branch.id, type, ratioAtPointOnBranch(branch, hit.point));
        generateAirflowState();
        renderVentilationPreview();
        uiCallback();
    });
    animate();
}

function animate() { requestAnimationFrame(animate); controls.update(); renderer.render(scene, camera); }

export function loadOBJ(file) {
    if (State.nodes.length === 0) { alert("请先加载 .net 数据"); return; }
    const reader = new FileReader();
    reader.onload = (e) => {
        const loader = new OBJLoader();
        const obj = loader.parse(e.target.result);
        const meshes = [];
        obj.traverse(c => { if(c.isMesh) meshes.push(c); });
        const nC = State.nodes.length, cC = State.connections.length;
        meshes.forEach((mesh, i) => {
            const count = mesh.geometry.attributes.position.count;
            mesh.geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
            const colors = mesh.geometry.attributes.color;
            for(let k=0; k<count; k++) colors.setXYZ(k, 1, 1, 1);
            mesh.material = matNormal.clone();
            if (i < nC) { mesh.userData = { type: 'Node', index: i, data: State.nodes[i] }; mesh.name = `Node_${State.nodes[i].id}`; } 
            else if (i < nC + cC) { const idx = i - nC; mesh.userData = { type: 'Connection', index: idx, data: State.connections[idx] }; mesh.name = `Edge_${idx}`; }
        });
        if(rootGroup) { scene.remove(rootGroup); rootGroup.clear(); } 
        rootGroup = obj; scene.add(rootGroup);
        const box = new THREE.Box3().setFromObject(obj);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        controls.target.copy(center); camera.position.copy(center); camera.position.z += Math.max(size.x, size.y) * 1.5;
        renderVentilationPreview();
        alert("模型加载完成");
    };
    reader.readAsText(file);
}

export function updateSensors(minVal, maxVal) {
    sensorGroup.clear();
    if (State.isVentilationMode()) return;
    const isWind = State.activeDataType === 'WindSpeed';
    const geo = isWind ? new THREE.ConeGeometry(3, 8, 8) : new THREE.BoxGeometry(6, 6, 6);
    if(isWind) geo.rotateX(Math.PI/2); 

    State.sensors.forEach(s => {
        const c = getHeatmapColor(s.value, minVal, maxVal);
        const mat = new THREE.MeshLambertMaterial({ color: c });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(s.x, s.y, s.z);
        if (isWind) {
            const conn = State.connections[s.parentIndex];
            if(conn) {
                const totalSegs = conn.verts.length - 1;
                const segIdx = Math.min(Math.floor(s.ratio * totalSegs), totalSegs-1);
                const v1 = conn.verts[segIdx];
                const v2 = conn.verts[segIdx+1];
                const dir = new THREE.Vector3(v2.x-v1.x, v2.y-v1.y, v2.z-v1.z).normalize();
                if(s.direction === -1) dir.negate();
                mesh.lookAt(new THREE.Vector3(s.x, s.y, s.z).add(dir));
            }
        }
        mesh.userData = { type: 'Sensor', data: s };
        sensorGroup.add(mesh);
    });
}

export function updateNetLines() {
    linesGroup.clear(); const mat = new THREE.LineBasicMaterial({ color: 0xffff00 });
    State.connections.forEach(c => {
        const points = c.verts.map(v => new THREE.Vector3(v.x, v.y, v.z));
        linesGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), mat));
    });
}

export function renderVentilationPreview() {
    if (!ventilationGroup) return;
    ventilationGroup.clear();
    if (!State.isVentilationMode()) return;
    ensureVentilationNetwork();
    const rows = currentAirflowByBranch();
    const range = valueRange(State.airflowSettings.variable);
    const arrowGeo = new THREE.ConeGeometry(2.4, 8, 10);
    arrowGeo.rotateX(Math.PI / 2);

    State.ventilationNetwork.branches.forEach((branch) => {
        if (!branch.path || branch.path.length < 2) return;
        const row = rows.get(branch.id);
        const value = row ? row[State.airflowSettings.variable] : branch.designAirQuantity;
        const color = new THREE.Color(colorForValue(value, range, row?.anomaly_type));
        const lineMat = new THREE.LineBasicMaterial({
            color,
            transparent: true,
            opacity: branch.id === State.selectedVentilationBranchId ? 1 : 0.75
        });
        const points = branch.path.map((p) => new THREE.Vector3(p.x, p.y, p.z));
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), lineMat);
        line.userData = { type: 'VentilationBranch', data: branch };
        ventilationGroup.add(line);

        const arrowCount = Math.max(1, Math.floor(branch.length / 90));
        for (let i = 0; i < arrowCount; i += 1) {
            const sample = sampleBranchPath(branch.path, (i + 0.5) / arrowCount);
            if (!sample) continue;
            const direction = row?.direction || branch.nominalDirection || 'from_to';
            const quantity = Math.abs(Number(row?.air_quantity_m3s ?? branch.designAirQuantity ?? 0));
            if (direction === 'blocked' || row?.direction_sign === 0 || quantity <= 0.05) continue;
            if (direction === 'to_from') sample.tangent.negate();
            const scale = 0.8 + Math.min(2.4, quantity / 15);
            const arrow = new THREE.Mesh(arrowGeo, new THREE.MeshLambertMaterial({ color }));
            arrow.position.copy(sample.position);
            arrow.lookAt(sample.position.clone().add(sample.tangent));
            arrow.scale.set(scale, scale, scale);
            arrow.userData = { type: 'VentilationBranch', data: branch };
            ventilationGroup.add(arrow);
        }
    });
    State.ventilationNetwork.facilities.forEach((facility) => renderFacilityGlyph(facility));
    renderBoundaryGlyphs();
}

function renderBoundaryGlyphs() {
    State.ventilationNetwork.nodes
        .filter((node) => node.type === 'intake' || node.type === 'return')
        .forEach((node) => {
            const roadwayNode = State.nodes.find((item) => `Node_${item.id}` === node.roadwayNodeId);
            const color = node.type === 'intake' ? 0x1d8cff : 0xef4444;
            const mat = new THREE.MeshLambertMaterial({
                color,
                emissive: new THREE.Color(color).multiplyScalar(0.22)
            });
            const group = new THREE.Group();
            group.position.set(node.position.x, node.position.y, node.position.z + 4);
            const cone = new THREE.Mesh(new THREE.ConeGeometry(4, 12, 16), mat);
            cone.rotation.x = node.type === 'intake' ? Math.PI : 0;
            cone.position.z = node.type === 'intake' ? 6 : -6;
            group.add(cone);
            const ring = new THREE.Mesh(new THREE.TorusGeometry(6, 0.7, 8, 28), mat);
            ring.rotation.x = Math.PI / 2;
            group.add(ring);
            group.userData = { type: 'Node', data: roadwayNode || node, index: roadwayNode?.idx ?? -1 };
            group.traverse((child) => {
                child.userData = { type: 'Node', data: roadwayNode || node, index: roadwayNode?.idx ?? -1 };
            });
            ventilationGroup.add(group);
        });
}

function renderFacilityGlyph(facility) {
    const placement = facilityPlacement(facility);
    if (!placement) return;
    const visual = FacilityVisuals[facility.type] || { label: facility.type, color: '#ffffff' };
    const color = new THREE.Color(visual.color);
    const isSelected = facility.id === State.selectedFacilityId;
    const group = new THREE.Group();
    group.position.set(placement.position.x, placement.position.y, placement.position.z);
    const tangent = new THREE.Vector3(placement.tangent.x, placement.tangent.y, placement.tangent.z).normalize();
    group.lookAt(group.position.clone().add(tangent));
    group.scale.setScalar(isSelected ? 1.35 : 1);
    group.userData = { type: 'VentilationFacility', data: facility };

    const mat = new THREE.MeshLambertMaterial({
        color,
        emissive: isSelected ? new THREE.Color(0x333333) : new THREE.Color(0x000000)
    });
    const darkMat = new THREE.MeshLambertMaterial({ color: 0x111827 });
    const whiteMat = new THREE.MeshLambertMaterial({ color: 0xffffff });

    if (facility.type === 'fan') {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(4.8, 0.7, 10, 28), mat);
        group.add(ring);
        for (let i = 0; i < 3; i += 1) {
            const blade = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.8, 0.35), darkMat);
            blade.position.x = 1.7;
            blade.rotation.z = (Math.PI * 2 * i) / 3;
            group.add(blade);
        }
    } else if (facility.type === 'door') {
        const panel = new THREE.Mesh(new THREE.BoxGeometry(1.4, 8.5, 7), mat);
        group.add(panel);
        const diagonal = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.5, 10.2), whiteMat);
        diagonal.rotation.x = Math.PI / 4;
        group.add(diagonal);
    } else if (facility.type === 'regulator') {
        const diamond = new THREE.Mesh(new THREE.OctahedronGeometry(5.2, 0), mat);
        group.add(diamond);
        const slit = new THREE.Mesh(new THREE.BoxGeometry(7.2, 0.55, 0.55), darkMat);
        group.add(slit);
    } else {
        const wall = new THREE.Mesh(new THREE.BoxGeometry(7.8, 1.1, 5.6), mat);
        group.add(wall);
        const crossA = new THREE.Mesh(new THREE.BoxGeometry(9.2, 0.7, 0.7), whiteMat);
        crossA.rotation.z = Math.PI / 4;
        group.add(crossA);
        const crossB = new THREE.Mesh(new THREE.BoxGeometry(9.2, 0.7, 0.7), whiteMat);
        crossB.rotation.z = -Math.PI / 4;
        group.add(crossB);
    }

    group.traverse((child) => {
        child.userData = { type: 'VentilationFacility', data: facility };
    });
    ventilationGroup.add(group);
}

function sampleBranchPath(path, ratio) {
    const lengths = [];
    let total = 0;
    for (let i = 0; i < path.length - 1; i += 1) {
        const a = path[i], b = path[i + 1];
        const len = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
        lengths.push(len);
        total += len;
    }
    if (!total) return null;
    let distance = total * Math.max(0, Math.min(1, ratio));
    let index = 0;
    while (index < lengths.length - 1 && distance > lengths[index]) {
        distance -= lengths[index];
        index += 1;
    }
    const a = path[index], b = path[index + 1];
    const t = lengths[index] ? distance / lengths[index] : 0;
    const position = new THREE.Vector3(
        a.x + (b.x - a.x) * t,
        a.y + (b.y - a.y) * t,
        a.z + (b.z - a.z) * t
    );
    const tangent = new THREE.Vector3(b.x - a.x, b.y - a.y, b.z - a.z).normalize();
    return { position, tangent };
}

/**
 * 矢量场渲染 v2 (优化版)
 * 1. 使用势能场解决方向冲突
 * 2. 使用均匀物理间距解决分布不均
 * 3. 使用插值数值解决颜色突变
 */
export function renderVectorField(minVal, maxVal) {
    updateSensors(minVal, maxVal);
    vectorGroup.clear();
    
    if(rootGroup) {
        rootGroup.traverse(m => { if(m.isMesh && m.geometry.attributes.color) { 
            const c = m.geometry.attributes.color; for(let i=0; i<c.count; i++) c.setXYZ(i, 0.3, 0.3, 0.3); // 暗色背景
            c.needsUpdate = true; 
        }});
    }
    
    // 1. 算法准备
    calculateAirflowField(); // 势能场解算方向
    const nodeVals = calculateNetworkValues(minVal); // 数值场解算大小

    const arrowGeo = new THREE.ConeGeometry(2, 8, 8); 
    arrowGeo.rotateX(Math.PI/2); 
    
    const TARGET_SPACING = 25; // 目标物理间距 (例如每25米一个箭头)

    State.connections.forEach(conn => {
        // --- 准备该巷道的插值器 ---
        const v1Val = nodeVals.get(conn.j1);
        const v2Val = nodeVals.get(conn.j2);
        let pts = [{t: 0, v: v1Val}, {t: 1, v: v2Val}];
        State.sensors.forEach(s => {
            if (s.parentType === 'Connection' && s.parentIndex === conn.idx) {
                pts.push({t: s.ratio, v: s.value});
            }
        });
        pts.sort((a, b) => a.t - b.t);

        const getValueAtT = (t) => {
            let val = minVal;
            for(let k=0; k<pts.length-1; k++) {
                if(t >= pts[k].t && t <= pts[k+1].t) {
                    const range = pts[k+1].t - pts[k].t;
                    const factor = range === 0 ? 0 : (t - pts[k].t) / range;
                    val = pts[k].v + (pts[k+1].v - pts[k].v) * factor;
                    break;
                }
            }
            return val;
        };

        // --- 计算巷道几何与长度 ---
        let totalLen = 0;
        const segmentLens = [];
        for(let i=0; i<conn.verts.length-1; i++) {
            const d = new THREE.Vector3(conn.verts[i].x, conn.verts[i].y, conn.verts[i].z)
                        .distanceTo(new THREE.Vector3(conn.verts[i+1].x, conn.verts[i+1].y, conn.verts[i+1].z));
            segmentLens.push(d);
            totalLen += d;
        }

        if (totalLen < 0.1) return;

        // --- 均匀采样逻辑 ---
        const arrowCount = Math.max(1, Math.floor(totalLen / TARGET_SPACING));
        const actualSpacing = totalLen / arrowCount;

        // 获取全局方向 (1 or -1)
        const globalDir = State.airflowDirections.get(conn.idx) || 1;

        let currentDist = actualSpacing / 2; // 从半个间距处开始，保证两头不顶到节点
        
        for (let i = 0; i < arrowCount; i++) {
            // 1. 寻找当前距离所在的线段 (geometry segment)
            let tempDist = currentDist;
            let segIdx = 0;
            while (segIdx < segmentLens.length && tempDist > segmentLens[segIdx]) {
                tempDist -= segmentLens[segIdx];
                segIdx++;
            }
            // 容错
            if (segIdx >= segmentLens.length) { segIdx = segmentLens.length - 1; tempDist = segmentLens[segIdx]; }

            // 2. 计算具体位置
            const pStart = conn.verts[segIdx];
            const pEnd = conn.verts[segIdx+1];
            const ratioInSeg = tempDist / segmentLens[segIdx];
            
            const posX = pStart.x + (pEnd.x - pStart.x) * ratioInSeg;
            const posY = pStart.y + (pEnd.y - pStart.y) * ratioInSeg;
            const posZ = pStart.z + (pEnd.z - pStart.z) * ratioInSeg;

            // 3. 计算全局 T (0~1) 用于数值插值
            const globalT = currentDist / totalLen;
            const speed = getValueAtT(globalT);

            // 4. 确定方向
            const tangent = new THREE.Vector3(pEnd.x - pStart.x, pEnd.y - pStart.y, pEnd.z - pStart.z).normalize();
            if (globalDir === -1) tangent.negate();

            // 5. 生成箭头
            const color = getHeatmapColor(speed, minVal, maxVal);
            const arrow = new THREE.Mesh(arrowGeo, new THREE.MeshLambertMaterial({ color: color }));
            arrow.position.set(posX, posY, posZ);
            
            const targetPos = new THREE.Vector3(posX + tangent.x, posY + tangent.y, posZ + tangent.z);
            arrow.lookAt(targetPos);
            
            const s = 0.5 + (Math.min(speed, maxVal) / maxVal) * 1.5; // 限制最大缩放
            arrow.scale.set(s, s, s);
            vectorGroup.add(arrow);

            // 步进
            currentDist += actualSpacing;
        }
    });
}

// 标量场渲染 (保持之前对 Node 的优化)
export function renderHeatmap(minVal, maxVal) {
    updateSensors(minVal, maxVal); vectorGroup.clear();
    if (!rootGroup) return;
    const nodeVals = calculateNetworkValues(minVal);
    
    rootGroup.traverse(mesh => {
        if (!mesh.isMesh || !mesh.userData.data) return;
        const { type, data } = mesh.userData;
        const colors = mesh.geometry.attributes.color;
        const pos = mesh.geometry.attributes.position;

        // 辅助函数：计算巷道端点值 (优先取传感器，否则取节点值)
        // 注意：这里要处理 Connection 和 Node 的衔接
        const getEndValue = (nodeId, connIdx) => {
            // ... 逻辑同前 ...
            return nodeVals.get(nodeId); 
        };

        if (type === 'Connection') {
            const v1 = nodeVals.get(data.j1); const v2 = nodeVals.get(data.j2);
            let pts = [{t: 0, v: v1}, {t: 1, v: v2}];
            State.sensors.forEach(s => {
                if (s.parentType === 'Connection' && s.parentIndex === data.idx) {
                    // 重新计算 t
                    const P1 = new THREE.Vector3(data.verts[0].x, data.verts[0].y, data.verts[0].z);
                    const P2 = new THREE.Vector3(data.verts[data.verts.length-1].x, data.verts[data.verts.length-1].y, data.verts[data.verts.length-1].z);
                    const V = new THREE.Vector3().subVectors(P2, P1);
                    const S = new THREE.Vector3(s.x, s.y, s.z);
                    let t = new THREE.Vector3().subVectors(S, P1).dot(V) / V.lengthSq();
                    t = Math.max(0, Math.min(1, t)); pts.push({t, v: s.value});
                }
            });
            pts.sort((a, b) => a.t - b.t);

            // 简单几何向量，用于投影
            const P1 = new THREE.Vector3(data.verts[0].x, data.verts[0].y, data.verts[0].z);
            const P2 = new THREE.Vector3(data.verts[data.verts.length-1].x, data.verts[data.verts.length-1].y, data.verts[data.verts.length-1].z);
            const Vec = new THREE.Vector3().subVectors(P2, P1);
            const lenSq = Vec.lengthSq();

            for (let i = 0; i < colors.count; i++) {
                const V = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i));
                let t = new THREE.Vector3().subVectors(V, P1).dot(Vec) / lenSq;
                t = Math.max(0, Math.min(1, t));
                let val = v1;
                for(let k=0; k<pts.length-1; k++) if(t >= pts[k].t && t <= pts[k+1].t) { val = pts[k].v + (pts[k+1].v - pts[k].v) * ((t - pts[k].t) / (pts[k+1].t - pts[k].t || 1)); break; }
                const c = getHeatmapColor(val, minVal, maxVal); colors.setXYZ(i, c.r, c.g, c.b);
            }
        } else if (type === 'Node') {
            // Node 逻辑保持之前的“向量投影插值”以保证平滑
            const centerVal = nodeVals.get(data.id);
            const centerPos = new THREE.Vector3(data.x, data.y, data.z);
            const conns = State.nodeConnMap.get(data.id) || [];
            const neighbors = conns.map(conn => {
                const isStart = (conn.j1 === data.id);
                const P_node = isStart ? conn.verts[0] : conn.verts[conn.verts.length-1];
                const P_far = isStart ? conn.verts[1] : conn.verts[conn.verts.length-2];
                if(!P_far) return null;
                const dir = new THREE.Vector3(P_far.x - P_node.x, P_far.y - P_node.y, P_far.z - P_node.z).normalize();
                // 取邻居节点的值作为远处目标
                const farVal = nodeVals.get(isStart ? conn.j2 : conn.j1);
                const dist = new THREE.Vector3(P_node.x, P_node.y, P_node.z).distanceTo(new THREE.Vector3(P_far.x, P_far.y, P_far.z)) || 1;
                const slope = (farVal - centerVal) / (dist * 10); // 这里的slope需要根据实际模型大小调节
                return { dir, slope };
            }).filter(n => n !== null);

            for(let i=0; i<colors.count; i++) {
                const V = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i));
                const vec = new THREE.Vector3().subVectors(V, centerPos);
                const dist = vec.length();
                const vecNorm = vec.clone().normalize();
                let bestDot = -1.0, bestSlope = 0;
                for(const nb of neighbors) { const dot = vecNorm.dot(nb.dir); if(dot > bestDot) { bestDot = dot; bestSlope = nb.slope; } }
                let val = centerVal;
                if(bestDot > 0) val += (dist * bestDot) * bestSlope;
                const c = getHeatmapColor(val, minVal, maxVal); colors.setXYZ(i, c.r, c.g, c.b);
            }
        }
        colors.needsUpdate = true;
    });
}

export function clearHeatmap() { updateSensors(0, 100); vectorGroup.clear(); if(rootGroup) rootGroup.traverse(m => { if(m.isMesh && m.geometry.attributes.color) { const c = m.geometry.attributes.color; for(let i=0; i<c.count; i++) c.setXYZ(i, 1, 1, 1); c.needsUpdate = true; }}); }
export function highlight(type, id) {
    if (rootGroup) rootGroup.traverse(m => { if (m.isMesh && m.userData.data) { const isMatch = (type && m.userData.type === type && m.userData.index === id); m.material.emissive.setHex(isMatch ? 0x550000 : 0x000000); }});
    if (sensorGroup) sensorGroup.children.forEach(m => { if (m.userData.data) { const isMatch = (type === 'Sensor' && m.userData.data.id === id); m.material.emissive.setHex(isMatch ? 0xffffff : 0x000000); }});
    if (ventilationGroup) ventilationGroup.children.forEach(m => {
        if (!m.userData?.data) return;
        const isMatch = m.userData.data.id === State.selectedVentilationBranchId;
        if (m.material) {
            m.material.opacity = isMatch ? 1 : 0.72;
            m.material.transparent = true;
        }
    });
}
export function toggleWireframe(active) { isWireframe = active; if(rootGroup) rootGroup.traverse(m => { if(m.isMesh) m.material.wireframe = isWireframe; }); }
export function toggleAxes(active) { if(axesHelper) axesHelper.visible = active; }
export function toggleNetLines(active) { if(linesGroup) { linesGroup.visible = active; if(active && linesGroup.children.length === 0) updateNetLines(); }}
export function getRootGroup() { return rootGroup; }
