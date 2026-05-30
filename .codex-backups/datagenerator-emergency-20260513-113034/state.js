export const State = {
    // 基础数据
    layers: [],
    lines: [],
    texts: [],
    nodes: [],
    connections: [],
    
    // 拓扑映射
    nodeMap: new Map(),
    nodeConnMap: new Map(),
    
    // 元数据
    counts: {},
    
    // 数据存储
    // dataStore: { Type: [SensorObjects...] }
    dataStore: {
        Temperature: [],
        Humidity: [],
        CH4: [],
        CO: [],
        WindSpeed: []
    },
    
    // 当前激活的传感器列表引用
    sensors: [], 
    activeDataType: 'Temperature',
    generationMode: 'environmental-sensors',

    // 通风网络定义 (新增)
    // Map<NodeID(int), 'Inlet' | 'Outlet'>
    ventilationNodes: new Map(),
    // Map<NodeID(int), { kind, label, pressurePa, capacityM3s }>
    ventilationBoundaryParams: new Map(),
    
    // 自动计算的风流方向缓存 (新增)
    // Map<ConnectionIdx(int), 1 | -1> (1: j1->j2, -1: j2->j1)
    airflowDirections: new Map(),

    ventilationNetwork: {
        nodes: [],
        branches: [],
        facilities: [],
        relations: []
    },
    selectedVentilationBranchId: null,
    selectedFacilityId: null,
    airflowState: [],
    airflowSettings: {
        strategy: 'edge-based',
        scenario: 'normal',
        variable: 'air_quantity_m3s',
        timeIndex: 0,
        timeSteps: 60,
        intervalMinutes: 5,
        eventStart: 20,
        eventEnd: 40,
        intensity: 0.8
    },

    // 视口状态
    layerVisibility: new Map(),
    dataBounds: { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity, defined: false },
    selectedEntity: null,
    
    coordParams: {
        active: true,
        ox: 0, oy: 0, oz: 0,
        invertY: true,
        scale: 1.0
    },

    reset() {
        const previousGenerationMode = this.generationMode || 'environmental-sensors';
        this.layers = []; this.lines = []; this.texts = [];
        this.nodes = []; this.connections = [];
        
        this.dataStore = { Temperature: [], Humidity: [], CH4: [], CO: [], WindSpeed: [] };
        this.sensors = this.dataStore.Temperature;
        this.activeDataType = 'Temperature';
        this.generationMode = previousGenerationMode;
        
        this.nodeMap.clear(); this.nodeConnMap.clear(); this.layerVisibility.clear();
        this.counts = {};
        this.dataBounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity, defined: false };
        this.selectedEntity = null;
        
        this.ventilationNodes.clear();
        this.ventilationBoundaryParams.clear();
        this.airflowDirections.clear();
        this.ventilationNetwork = { nodes: [], branches: [], facilities: [], relations: [] };
        this.selectedVentilationBranchId = null;
        this.selectedFacilityId = null;
        this.airflowState = [];
    },

    updateBounds(x, y) {
        if (x < this.dataBounds.minX) this.dataBounds.minX = x;
        if (x > this.dataBounds.maxX) this.dataBounds.maxX = x;
        if (y < this.dataBounds.minY) this.dataBounds.minY = y;
        if (y > this.dataBounds.maxY) this.dataBounds.maxY = y;
        this.dataBounds.defined = true;
    },
    
    switchMode(type) {
        this.activeDataType = type;
        if(!this.dataStore[type]) this.dataStore[type] = [];
        this.sensors = this.dataStore[type];
        this.selectedEntity = null;
    },

    switchGenerationMode(mode) {
        this.generationMode = mode;
        this.selectedEntity = null;
    },

    isEnvironmentalMode() {
        return this.generationMode === 'environmental-sensors';
    },

    isVentilationMode() {
        return this.generationMode === 'ventilation';
    }
};
