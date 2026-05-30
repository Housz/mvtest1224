import { State } from '../state.js';
import { getClosestPointOnSegment3D } from '../algorithms.js';
import { getHeatmapColor } from '../utils.js';
import {
    addFacilityToBranch,
    FacilityVisuals,
    colorForValue,
    currentAirflowByBranch,
    ensureVentilationNetwork,
    facilityPlacement,
    findBranchAt2D,
    findBranchHitAt2D,
    findFacilityAt2D,
    generateAirflowState,
    selectBranch,
    selectFacility,
    valueRange
} from '../ventilation.js';

let canvas, ctx, updateUICallback;
let scale = 1.0, panOffset = { x: 0, y: 0 };
let isPanning = false, panStart = { x: 0, y: 0 };

export function init2D(canvasEl, callback) {
    canvas = canvasEl; ctx = canvas.getContext('2d'); updateUICallback = callback;
    const resize = () => { if(canvas.parentElement) { canvas.width = canvas.parentElement.clientWidth; canvas.height = canvas.parentElement.clientHeight; draw2D(); }};
    window.addEventListener('resize', resize);
    canvas.addEventListener('mousedown', e => { if(e.button===1||e.button===2) return; isPanning=true; panStart={x:e.clientX, y:e.clientY}; canvas.style.cursor='grabbing'; });
    window.addEventListener('mousemove', e => {
        if(isPanning) { panOffset.x+=e.clientX-panStart.x; panOffset.y+=e.clientY-panStart.y; panStart={x:e.clientX,y:e.clientY}; draw2D(); }
        const r=canvas.getBoundingClientRect(); const wx=(e.clientX-r.left-panOffset.x)/scale, wy=-(e.clientY-r.top-panOffset.y)/scale;
        const sb=document.getElementById('status-bar'); if(sb) sb.textContent=`2D: ${wx.toFixed(2)}, ${wy.toFixed(2)}`;
    });
    window.addEventListener('mouseup', ()=>{ isPanning=false; canvas.style.cursor='crosshair'; });
    canvas.addEventListener('wheel', e=>{
        e.preventDefault(); const r=canvas.getBoundingClientRect(), mx=e.clientX-r.left, my=e.clientY-r.top;
        const wx=(mx-panOffset.x)/scale, wy=-(my-panOffset.y)/scale;
        scale*=(e.deltaY<0?1.1:0.9); panOffset.x=mx-wx*scale; panOffset.y=my-(-wy)*scale; draw2D();
    });
    canvas.addEventListener('contextmenu', e=>{
        e.preventDefault(); const r=canvas.getBoundingClientRect(), wx=(e.clientX-r.left-panOffset.x)/scale, wy=-(e.clientY-r.top-panOffset.y)/scale;
        if (State.isEnvironmentalMode()) tryAddSensor(wx, wy);
        else if (State.isVentilationMode()) tryAddFacility(wx, wy);
    });
    canvas.addEventListener('click', e=>{
        if(e.button!==0) return; const r=canvas.getBoundingClientRect(), wx=(e.clientX-r.left-panOffset.x)/scale, wy=-(e.clientY-r.top-panOffset.y)/scale;
        selectEntity(wx, wy);
    });
    resize();
}

export function autoZoom2D() {
    if (!State.dataBounds.defined) return;
    const m=50, cw=canvas.width-m*2, ch=canvas.height-m*2;
    const bw=State.dataBounds.maxX-State.dataBounds.minX, bh=State.dataBounds.maxY-State.dataBounds.minY;
    if(bw===0||bh===0) return;
    scale=Math.min(cw/bw, ch/bh);
    const cx=(State.dataBounds.minX+State.dataBounds.maxX)/2, cy=(State.dataBounds.minY+State.dataBounds.maxY)/2;
    panOffset.x=canvas.width/2-cx*scale; panOffset.y=canvas.height/2+cy*scale;
    draw2D();
}

export function draw2D() {
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(panOffset.x, panOffset.y);
    ctx.scale(scale, scale);

    const minVal = parseFloat(document.getElementById('hm-min')?.value || 0);
    const maxVal = parseFloat(document.getElementById('hm-max')?.value || 100);
    const isVentilation = State.isVentilationMode();
    const isEnvironmental = State.isEnvironmentalMode();
    const isWind = isEnvironmental && State.activeDataType === 'WindSpeed';
    const airflowRows = isVentilation ? currentAirflowByBranch() : new Map();
    const airflowRange = isVentilation ? valueRange(State.airflowSettings.variable) : { min: 0, max: 1 };

    // 1. 巷道
    ctx.lineWidth = 1 / scale; ctx.strokeStyle = '#666';
    for (const c of State.connections) {
        if (!State.layerVisibility.get(c.layer)) continue;
        ctx.beginPath(); c.verts.forEach((v, i) => i === 0 ? ctx.moveTo(v.x, -v.y) : ctx.lineTo(v.x, -v.y)); ctx.stroke();
    }

    if (isVentilation && State.ventilationNetwork.branches.length) {
        ensureVentilationNetwork();
        State.ventilationNetwork.branches.forEach((branch) => {
            const row = airflowRows.get(branch.id);
            const value = row ? row[State.airflowSettings.variable] : branch.designAirQuantity;
            ctx.strokeStyle = colorForValue(value, airflowRange, row?.anomaly_type);
            ctx.lineWidth = (branch.id === State.selectedVentilationBranchId ? 5 : 2.5) / scale;
            ctx.beginPath();
            branch.path.forEach((v, i) => i === 0 ? ctx.moveTo(v.x, -v.y) : ctx.lineTo(v.x, -v.y));
            ctx.stroke();
            drawBranchArrow(ctx, branch, row, scale);
        });
        State.ventilationNetwork.facilities.forEach((facility) => drawFacilitySymbol(ctx, facility, scale));
    }
    // 2. 线
    ctx.strokeStyle = '#888';
    for (const l of State.lines) {
        if (!State.layerVisibility.get(l.layer)) continue;
        ctx.beginPath(); ctx.moveTo(l.x1, -l.y1); ctx.lineTo(l.x2, -l.y2); ctx.stroke();
    }
    // 3. 节点
    const ns = isWind ? 5/scale : 3/scale;
    for (const n of State.nodes) {
        if (!State.layerVisibility.get(n.layer)) continue;
        ctx.beginPath(); ctx.arc(n.x, -n.y, ns, 0, 2 * Math.PI);
        // 通风节点特殊颜色
        const ventType = State.ventilationNodes.get(n.id);
        if ((isVentilation || isWind) && ventType) {
            ctx.fillStyle = ventType==='Inlet' ? '#0088ff' : '#ff4400';
            ctx.fill();
            ctx.strokeStyle='#fff'; ctx.lineWidth=2/scale; ctx.stroke();
            // 文字
            ctx.save(); ctx.fillStyle='#fff'; ctx.font=`bold ${12/scale}px Arial`; ctx.fillText(ventType==='Inlet'?"IN":"OUT", n.x+ns, -n.y-ns); ctx.restore();
        } else {
            ctx.fillStyle = '#0ff'; ctx.fill();
        }
    }

    // 4. 传感器
    const ss = 8 / scale;
    if (isEnvironmental) for (const s of State.sensors) {
        const c = getHeatmapColor(s.value, minVal, maxVal);
        ctx.fillStyle = `#${c.getHexString()}`;
        
        if (isWind) {
            // 绘制箭头
            const conn = State.connections[s.parentIndex];
            if(conn) {
                // 计算局部方向
                // 为了简单，我们取传感器所在段的方向
                const totalSegs = conn.verts.length - 1;
                // 反解段索引 (近似)
                const segIdx = Math.min(Math.floor(s.ratio * totalSegs), totalSegs-1);
                const v1 = conn.verts[segIdx];
                const v2 = conn.verts[segIdx+1];
                let angle = Math.atan2(-(v2.y - v1.y), v2.x - v1.x); // Canvas Y inverted
                
                // 结合传感器方向
                if(s.direction === -1) angle += Math.PI;
                
                ctx.save(); ctx.translate(s.x, -s.y); ctx.rotate(angle);
                ctx.beginPath(); ctx.moveTo(-ss, -ss/2); ctx.lineTo(ss, 0); ctx.lineTo(-ss, ss/2); ctx.closePath();
                ctx.fill(); ctx.strokeStyle='#fff'; ctx.lineWidth=1/scale; ctx.stroke();
                ctx.restore();
            } else {
                ctx.fillRect(s.x-ss/2, -s.y-ss/2, ss, ss); // Fallback
            }
        } else {
            // 标量方块
            ctx.strokeStyle = '#fff'; ctx.lineWidth = 1 / scale;
            ctx.fillRect(s.x - ss / 2, -s.y - ss / 2, ss, ss);
            ctx.strokeRect(s.x - ss / 2, -s.y - ss / 2, ss, ss);
        }
        
        ctx.save(); ctx.font = `${10 / scale}px Arial`; ctx.fillStyle = "#fff"; ctx.fillText(s.value, s.x + ss, -s.y - ss); ctx.restore();
    }

    // 5. 文本
    ctx.fillStyle = '#ff0';
    for (const t of State.texts) {
        if (!State.layerVisibility.get(t.layer)) continue;
        ctx.font = `${t.h}px monospace`; ctx.save(); ctx.translate(t.x, -t.y); ctx.rotate(-t.angle * Math.PI / 180); ctx.fillText(t.s, 0, 0); ctx.restore();
    }

    // 6. 高亮
    if (State.selectedEntity) {
        const { type, data } = State.selectedEntity;
        ctx.strokeStyle = '#f00'; ctx.lineWidth = 2 / scale; ctx.fillStyle = '#f00';
        if (type === 'Sensor') {
            const ss2 = 12 / scale; ctx.strokeRect(data.x - ss2 / 2, -data.y - ss2 / 2, ss2, ss2);
        } else if (type === 'Node') {
            ctx.beginPath(); ctx.arc(data.x, -data.y, 6 / scale, 0, 2 * Math.PI); ctx.stroke();
        } else if (type === 'Connection') {
            ctx.beginPath(); data.verts.forEach((v, i) => i === 0 ? ctx.moveTo(v.x, -v.y) : ctx.lineTo(v.x, -v.y)); ctx.stroke();
        } else if (type === 'VentilationFacility') {
            drawFacilitySymbol(ctx, data, scale, true);
        }
    }
    ctx.restore();
}

function tryAddFacility(wx, wy) {
    const tol = 12 / scale;
    const hit = findBranchHitAt2D({ x: wx, y: wy }, tol);
    if (!hit) return;
    const type = document.getElementById('vent-facility-type')?.value || 'fan';
    addFacilityToBranch(hit.branch.id, type, hit.ratio);
    generateAirflowState();
    draw2D();
    updateUICallback();
}

function tryAddSensor(wx, wy) {
    const tol = 12 / scale;
    // 如果是风速模式，允许在 Node 上点击来设置进出风口（但这是 Select 逻辑）
    // Add Sensor 只允许在 Edge 上。
    // Check Node proximity
    for (const n of State.nodes) {
        if (!State.layerVisibility.get(n.layer)) continue;
        if (Math.hypot(n.x - wx, n.y - wy) < tol) { return; }
    }

    let bestDist = tol, bestInfo = null;
    for (const c of State.connections) {
        if (!State.layerVisibility.get(c.layer)) continue;
        for (let i = 0; i < c.verts.length - 1; i++) {
            const v1 = c.verts[i], v2 = c.verts[i+1];
            const res = getClosestPointOnSegment3D({x:wx, y:wy}, v1, v2);
            if (res.dist < bestDist) {
                bestDist = res.dist;
                const segLen = Math.hypot(v1.x - v2.x, v1.y - v2.y);
                const distIn = Math.hypot(res.x - v1.x, res.y - v1.y);
                const ratioInSeg = segLen > 0 ? distIn / segLen : 0;
                const totalSegs = c.verts.length - 1;
                const globalRatio = (i + ratioInSeg) / totalSegs;
                bestInfo = { x: res.x, y: res.y, z: res.z, pt: 'Connection', pi: c.idx, pid: `Conn ${c.j1}-${c.j2}`, ratio: globalRatio };
            }
        }
    }
    if (bestInfo) {
        const s = { 
            id: Date.now(), type: 'Sensor', 
            x: bestInfo.x, y: bestInfo.y, z: bestInfo.z, value: 0, 
            parentType: bestInfo.pt, parentIndex: bestInfo.pi, parentId: bestInfo.pid, ratio: bestInfo.ratio,
            direction: 1 // 默认为正向 (J1->J2)
        };
        State.sensors.push(s); State.selectedEntity = { type: 'Sensor', data: s, index: -1 };
        draw2D(); updateUICallback();
    }
}

function selectEntity(wx, wy) {
    const tol = 8 / scale;
    let found = null;
    if (State.isEnvironmentalMode()) {
        found = State.sensors.find(s => Math.hypot(s.x - wx, s.y - wy) < tol);
        if (found) { State.selectedEntity = { type: 'Sensor', data: found, index: -1 }; draw2D(); updateUICallback(); return; }
    }
    if (State.isVentilationMode()) {
        const facility = findFacilityAt2D({ x: wx, y: wy }, tol * 1.4);
        if (facility) {
            selectFacility(facility.id);
            draw2D();
            updateUICallback();
            return;
        }
        found = State.nodes.find(n => State.layerVisibility.get(n.layer) && Math.hypot(n.x - wx, n.y - wy) < tol * 1.5);
        if (found) {
            State.selectedEntity = { type: 'Node', data: found, index: found.idx };
            draw2D();
            updateUICallback();
            return;
        }
        const branch = findBranchAt2D({ x: wx, y: wy }, tol);
        if (branch) {
            selectBranch(branch.id);
            draw2D();
            updateUICallback();
            return;
        }
    }
    found = State.nodes.find(n => State.layerVisibility.get(n.layer) && Math.hypot(n.x - wx, n.y - wy) < tol);
    if (found) { State.selectedEntity = { type: 'Node', data: found, index: found.idx }; draw2D(); updateUICallback(); return; }
    found = State.connections.find(c => {
        if (!State.layerVisibility.get(c.layer)) return false;
        for (let i = 0; i < c.verts.length - 1; i++) {
            const v1 = c.verts[i], v2 = c.verts[i+1];
            if (getClosestPointOnSegment3D({x:wx, y:wy}, v1, v2).dist < tol) return true;
        }
        return false;
    });
    if (found) State.selectedEntity = { type: 'Connection', data: found, index: found.idx };
    else State.selectedEntity = null;
    draw2D(); updateUICallback();
}

function drawBranchArrow(ctx, branch, row, scaleValue) {
    if (!branch.path || branch.path.length < 2) return;
    const direction = row?.direction || branch.nominalDirection || 'from_to';
    const quantity = Math.abs(Number(row?.air_quantity_m3s ?? branch.designAirQuantity ?? 0));
    if (direction === 'blocked' || row?.direction_sign === 0 || quantity <= 0.05) return;
    const midIndex = Math.max(0, Math.floor((branch.path.length - 1) / 2));
    const a = branch.path[midIndex];
    const b = branch.path[midIndex + 1] || branch.path[midIndex];
    const sign = direction === 'to_from' ? -1 : 1;
    const x = (a.x + b.x) / 2;
    const y = (a.y + b.y) / 2;
    let angle = Math.atan2(-(b.y - a.y), b.x - a.x);
    if (sign < 0) angle += Math.PI;
    const size = 8 / scaleValue;
    ctx.save();
    ctx.translate(x, -y);
    ctx.rotate(angle);
    ctx.fillStyle = branch.id === State.selectedVentilationBranchId ? '#ffffff' : '#dbeafe';
    ctx.beginPath();
    ctx.moveTo(size, 0);
    ctx.lineTo(-size * 0.55, -size * 0.45);
    ctx.lineTo(-size * 0.55, size * 0.45);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
}

function drawFacilitySymbol(ctx, facility, scaleValue, forceHighlight = false) {
    const placement = facilityPlacement(facility);
    if (!placement) return;
    const { position, tangent } = placement;
    const visual = FacilityVisuals[facility.type] || { label: facility.type, color: '#ffffff' };
    const isSelected = forceHighlight || facility.id === State.selectedFacilityId;
    const size = (isSelected ? 12 : 9) / scaleValue;
    const angle = Math.atan2(-tangent.y, tangent.x);

    ctx.save();
    ctx.translate(position.x, -position.y);
    ctx.rotate(angle);
    ctx.lineWidth = 1.6 / scaleValue;
    ctx.strokeStyle = isSelected ? '#ffffff' : '#111827';
    ctx.fillStyle = visual.color;

    if (facility.type === 'fan') {
        ctx.beginPath();
        ctx.arc(0, 0, size, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.strokeStyle = '#111827';
        for (let i = 0; i < 3; i += 1) {
            ctx.save();
            ctx.rotate((Math.PI * 2 * i) / 3);
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(size * 0.75, size * 0.22);
            ctx.stroke();
            ctx.restore();
        }
    } else if (facility.type === 'door') {
        ctx.fillRect(-size * 0.22, -size * 1.1, size * 0.44, size * 2.2);
        ctx.strokeRect(-size * 0.22, -size * 1.1, size * 0.44, size * 2.2);
        ctx.beginPath();
        ctx.moveTo(-size * 0.8, -size * 1.1);
        ctx.lineTo(size * 0.8, size * 1.1);
        ctx.stroke();
    } else if (facility.type === 'regulator') {
        ctx.beginPath();
        ctx.moveTo(0, -size);
        ctx.lineTo(size, 0);
        ctx.lineTo(0, size);
        ctx.lineTo(-size, 0);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(-size * 0.5, 0);
        ctx.lineTo(size * 0.5, 0);
        ctx.stroke();
    } else {
        ctx.fillRect(-size * 0.9, -size * 0.35, size * 1.8, size * 0.7);
        ctx.strokeRect(-size * 0.9, -size * 0.35, size * 1.8, size * 0.7);
        ctx.beginPath();
        ctx.moveTo(-size * 0.9, -size * 0.9);
        ctx.lineTo(size * 0.9, size * 0.9);
        ctx.moveTo(size * 0.9, -size * 0.9);
        ctx.lineTo(-size * 0.9, size * 0.9);
        ctx.stroke();
    }

    ctx.rotate(-angle);
    ctx.fillStyle = isSelected ? '#ffffff' : visual.color;
    ctx.font = `bold ${9 / scaleValue}px Arial`;
    ctx.textAlign = 'center';
    ctx.fillText(visual.label, 0, -size * 1.45);
    ctx.restore();
}
