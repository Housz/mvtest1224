# MineVis Prototype

MineVis 是一个轻量级的地下矿山可视化原型，使用原生 JavaScript + Three.js + ECharts 实现巷道拓扑、传感器台账与温度时序数据的联动。无需后端，`npm install && npm run dev` 即可运行。

## 特性
- 巷道拓扑 + 程序化巷道模型（未来可替换 GLTF）
- 温度传感器台账与时序数据（CSV）
- 功能 F1：传感器详情（3D 点击/列表 → 相机聚焦 → 折线图；支持 Billboard 嵌入 3D）
- 功能 F2：时间断面巷道着色（滑条选时刻 → 断面取值 → 图插值 → 色带控制）
- 原生节点系统编辑器：展示 Data / Operator / Function 节点与连线，可导出 `graph.json`

## 快速开始
```bash
npm install
npm run dev
```
浏览器打开控制台显示的地址即进入 **Editor**（配置者界面）：
- 拖动/缩放节点图，端口级连线（带类型校验，节点头按 Data/Operator/Function 着色）
- 通过右上角 Add node 下拉创建新的 Data/Function 节点，自动落在画布中心
- 选中数据节点在 Inspector 中配置数据源 URL、Role Mapping/Binding
- 点击 **Open Preview Window** 打开独立预览窗口（终端用户界面）
  - 左侧 Business/Function 菜单
  - 工作台包含 3D/2D/控件，使用 Editor 保存的 graph 配置驱动

## 目录结构
- `index.html`：入口 HTML
- `preview.html`：预览窗口入口（终端用户界面）
- `src/`：ES Module 源码
  - `core/datasets`：数据语义化与 Facet
  - `core/contracts`：Contract/RoleMapping/Binding 约定
  - `core/nodes`：Data 节点定义
  - `core/operators`：Operator 节点（选择、聚焦、查询、插值、着色）
  - `core/functions`：Function 节点占位，后续可封装管线
  - `scene/SceneManager.js`：Three.js 场景、模型生成、拾取
  - `ui/`：节点编辑器、传感器列表、Chart 管理、Inspector、Legend
  - `utils/colors.js`：色带与插值工具
- `public/data/`：示例数据（巷道拓扑、传感器、温度读数）

## 预览窗口与配置同步
- Editor 界面点击 **Save graph.json** 直接下载当前配置。
- 点击 **Open Preview Window** 打开 `preview.html`，预览窗口通过 `postMessage` 接收当前 graph（若未收到则使用内置示例）。
- 如需更新，返回 Editor 调整 → Save → Preview 中点击 Reload 即可。

## 数据语义化
- **Contract**：巷道 `node.id/edge.id`、传感器 `sensorID/x/y/z/roadwayID`、读数 `sensorID/value/time`
- **Role Mapping**：CSV/JSON 字段在 DataNode 中映射为统一结构
- **Binding**：传感器 `roadwayID` 绑定到巷道 node，读数 `sensorID` 绑定到传感器
- **Facet**：`SensorDataset.getSeries(sensorID)`、`getSnapshot(time,tolerance)` 提供 Series/Snapshot 视图

## 插值算法
`InterpolateOnRoadwayGraphOperator` 基于拓扑图：
1. 计算各节点到观测节点的最短路径（Dijkstra）
2. 用 `1/(d+eps)` 作为权重做加权平均得到节点值
3. 边值为两端节点平均
算法简洁易替换，可扩展为更复杂的热传导模型。

## 扩展新节点/功能
- 在 `NodeRegistry` 注册新的 Data/Operator/Function 类型后即可出现在 Add node 下拉；`kind` 控制节点头部颜色
- Data 节点的 `defaultParams`（如 `url`）会显示在 Inspector，可指向本地 JSON/CSV 或未来的 GLTF/OBJ
- 实现节点的 `execute`/`run`/`apply` 方法即可接入管线
- 节点编辑器 `NodeEditor` 使用 DOM + SVG，便于自定义端口、连线样式与保存/加载逻辑

## 后续工作建议
- 增加持久化 graph.json 的加载
- 支持真实 GLTF 巷道模型导入
- 在 Function 节点中内置 operator pipeline 配置面板
