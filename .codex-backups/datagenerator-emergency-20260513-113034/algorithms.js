import * as THREE from 'three';
import { State } from './state.js';

// 初始化拓扑关系
export function initTopology() {
    State.nodeConnMap.clear();
    State.nodes.forEach(n => State.nodeConnMap.set(n.id, []));
    State.connections.forEach(c => {
        if (State.nodeConnMap.has(c.j1)) State.nodeConnMap.get(c.j1).push(c);
        if (State.nodeConnMap.has(c.j2)) State.nodeConnMap.get(c.j2).push(c);
    });
}

/**
 * 核心算法：基于势能场 (Potential Field) 解算全网流向
 * 原理：流体由高势能(进风)流向低势能(出风)，中间节点势能为邻居平均值(拉普拉斯平滑)
 */
export function calculateAirflowField() {
    const nodePotential = new Map(); // 存储节点势能 0.0 ~ 1.0
    const edgeDirection = new Map(); // EdgeIdx -> 1 (正向) | -1 (反向) | 0 (静止)

    // 1. 初始化边界条件 (Boundary Conditions)
    const fixedNodes = [];
    State.nodes.forEach(n => {
        const type = State.ventilationNodes.get(n.id);
        if (type === 'Inlet') {
            nodePotential.set(n.id, 1.0); // 最高势能
            fixedNodes.push(n.id);
        } else if (type === 'Outlet') {
            nodePotential.set(n.id, 0.0); // 最低势能
            fixedNodes.push(n.id);
        } else {
            nodePotential.set(n.id, 0.5); // 初始猜测值
        }
    });

    // 兜底：如果未定义进出风口，使用 Z 轴高度模拟自然风压 (深部势能大，或者反之)
    if (fixedNodes.length === 0 && State.nodes.length > 0) {
        const minZ = Math.min(...State.nodes.map(n => n.z));
        const maxZ = Math.max(...State.nodes.map(n => n.z));
        const range = maxZ - minZ || 1;
        State.nodes.forEach(n => {
            // 假设 Z 越高势能越低 (热风向上) 或自定义
            nodePotential.set(n.id, (n.z - minZ) / range); 
        });
    } else {
        // 2. 迭代求解 (Iterative Solver)
        // 使用高斯-赛德尔迭代法扩散势能
        const iterations = 100; // 迭代次数，越多越平滑
        for (let k = 0; k < iterations; k++) {
            let maxDiff = 0;
            State.nodes.forEach(n => {
                if (State.ventilationNodes.has(n.id)) return; // 固定点跳过

                const conns = State.nodeConnMap.get(n.id) || [];
                if (conns.length === 0) return;

                let sumP = 0;
                conns.forEach(c => {
                    const neighborId = (c.j1 === n.id) ? c.j2 : c.j1;
                    sumP += nodePotential.get(neighborId);
                });

                const newP = sumP / conns.length;
                const diff = Math.abs(newP - nodePotential.get(n.id));
                if(diff > maxDiff) maxDiff = diff;
                
                nodePotential.set(n.id, newP);
            });
            
            // 如果收敛则提前退出
            if(maxDiff < 0.0001) break; 
        }
    }

    // 3. 根据势能梯度确定每条巷道的流向
    State.connections.forEach(c => {
        const p1 = nodePotential.get(c.j1);
        const p2 = nodePotential.get(c.j2);
        
        // 默认方向: J1 -> J2. 
        // 如果 P1 > P2, 则 J1->J2 (Dir=1)
        // 如果 P2 > P1, 则 J2->J1 (Dir=-1)
        let dir = (p1 >= p2) ? 1 : -1;
        
        // *特殊处理*：如果巷道上有传感器，且传感器被用户强制指定了反向，则覆盖物理计算
        const sensors = State.sensors.filter(s => s.parentType === 'Connection' && s.parentIndex === c.idx);
        const manualSensor = sensors.find(s => s.direction !== undefined); // 假设 UI 设置了 direction
        if (manualSensor) {
             // 这里逻辑较复杂，暂时以物理计算为主，除非需要强行逆转
             // 若需实现，可在此处覆盖 dir
        }

        edgeDirection.set(c.idx, dir);
    });

    State.airflowDirections = edgeDirection;
    return edgeDirection;
}

/**
 * 计算全网数值场 (用于插值无数据的区域)
 * 结合了传感器数据扩散
 */
export function calculateNetworkValues(minVal) {
    const nodeVals = new Map(); 
    // 初始化：有传感器的节点直接赋值，没有的设为null
    State.nodes.forEach(n => nodeVals.set(n.id, null));
    
    // 1. 提取源数据 (Node传感器)
    State.sensors.forEach(s => {
        if(s.parentType === 'Node') nodeVals.set(State.nodes[s.parentIndex].id, s.value);
    });

    // 2. 提取源数据 (Connection传感器 -> 投射到端点)
    // 如果巷道上有传感器，将其值作为强约束参与扩散
    State.connections.forEach(c => {
        const cSensors = State.sensors.filter(s => s.parentType === 'Connection' && s.parentIndex === c.idx);
        if (cSensors.length > 0) {
            // 取平均值投射给两端节点 (作为初始种子)
            const avg = cSensors.reduce((a,b) => a + b.value, 0) / cSensors.length;
            if (nodeVals.get(c.j1) === null) nodeVals.set(c.j1, avg);
            if (nodeVals.get(c.j2) === null) nodeVals.set(c.j2, avg);
        }
    });

    // 3. 数值扩散 (填补空缺)
    for(let iter=0; iter<10; iter++) {
        State.nodes.forEach(n => {
            // 如果该节点数值是“推测的”而非“测量的”，则继续平滑
            // 这里为了简化，对所有节点做平滑 (除了拥有直接Node传感器的)
            const hasDirectSensor = State.sensors.some(s => s.parentType === 'Node' && s.parentIndex === n.idx);
            if (hasDirectSensor) return;

            let sum = 0, count = 0;
            const conns = State.nodeConnMap.get(n.id) || [];
            
            conns.forEach(c => {
                const neighborId = (c.j1 === n.id) ? c.j2 : c.j1;
                const val = nodeVals.get(neighborId);
                if (val !== null) {
                    sum += val;
                    count++;
                }
            });
            
            if (count > 0) nodeVals.set(n.id, sum / count);
        });
    }

    // 4. 兜底：未覆盖区域设为 minVal
    State.nodes.forEach(n => {
        if(nodeVals.get(n.id) === null) nodeVals.set(n.id, minVal);
    });

    return nodeVals;
}

// 坐标转换 (保持不变)
export function applyCoordinateTransform() {
    State.dataBounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity, defined: false };
    const { active, ox, oy, oz, invertY, scale } = State.coordParams;

    const transform = (rawX, rawY, rawZ) => {
        if (!active) return { x: rawX, y: rawY, z: rawZ };
        let x = (rawX - ox) / scale;
        let y = (rawY - oy) / scale;
        if (invertY) y = -y;
        let z = rawZ - oz;
        return { x, y, z };
    };

    State.lines.forEach(l => {
        const p1 = transform(l.rawX1, l.rawY1, 0), p2 = transform(l.rawX2, l.rawY2, 0);
        l.x1 = p1.x; l.y1 = p1.y; l.x2 = p2.x; l.y2 = p2.y;
        State.updateBounds(l.x1, l.y1); State.updateBounds(l.x2, l.y2);
    });
    State.texts.forEach(t => {
        const p = transform(t.rawX, t.rawY, 0); t.x = p.x; t.y = p.y; State.updateBounds(t.x, t.y);
    });
    State.nodes.forEach(n => {
        const p = transform(n.rawX, n.rawY, n.rawZ);
        n.x = p.x; n.y = p.y; n.z = p.z; State.updateBounds(n.x, n.y);
    });
    State.connections.forEach(c => {
        c.verts = c.rawVerts.map(v => transform(v.x, v.y, v.z));
        c.verts.forEach(v => State.updateBounds(v.x, v.y));
    });
    State.sensors = [];
    State.ventilationNetwork = { nodes: [], branches: [], facilities: [], relations: [] };
    State.airflowState = [];
    State.selectedVentilationBranchId = null;
}

export function getClosestPointOnSegment3D(p, v1, v2) {
    const l2 = (v1.x - v2.x) ** 2 + (v1.y - v2.y) ** 2;
    let t = 0;
    if (l2 !== 0) {
        t = ((p.x - v1.x) * (v2.x - v1.x) + (p.y - v1.y) * (v2.y - v1.y)) / l2;
        t = Math.max(0, Math.min(1, t));
    }
    const projX = v1.x + t * (v2.x - v1.x);
    const projY = v1.y + t * (v2.y - v1.y);
    const projZ = v1.z + t * (v2.z - v1.z);
    return { dist: Math.hypot(p.x - projX, p.y - projY), x: projX, y: projY, z: projZ };
}
