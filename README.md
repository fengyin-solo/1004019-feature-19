# 城市地下管网巡检养护管理系统

面向城市地下管线登记建档、巡检任务、缺陷记录、外出维修、修复验收与设施档案全流程的地下管网巡检养护管理平台。

这是一个**纯前端**管理平台：Vue 3 + Vite + TypeScript，仓库里没有后端服务。业务数据由
`frontend/src/data/` 下的本地数据层提供：首次打开用示例数据播种，之后的登记、筛选与状态流转
结果都持久化在浏览器 `localStorage` 里，刷新或重开浏览器都还在。dev server 已关掉自动打开页面，
启动后按终端打印的地址手工打开。

## 目录结构

```text
.
├── frontend/                 Vue 3 + Vite + TypeScript 前端（唯一运行单元）
│   ├── src/views/            每个业务模块一个页面
│   ├── src/api/local-service.ts   本地数据服务：列表、筛选、动作流转、导出
│   ├── src/data/             模块元数据 / 示例数据 / localStorage 持久化
│   ├── src/stores/           会话与筛选状态
│   └── vite.config.ts        dev server 配置（open: false，无 /api 代理）
├── .gitignore
└── docker-compose.yml
```

## 启动

```bash
cd frontend
npm install
npm run dev
```

前端默认监听 `http://127.0.0.1:5173/`，dev server 不会自动打开浏览器，需要自己访问。

生产构建：

```bash
cd frontend
npm run build
```

## 业务模块

| 模块 | 目录 | 业务对象 | 主要字段 |
| --- | --- | --- | --- |
| 管线登记 | `pipeline` | 管线 | 管线编号、管线类型、起点位置 |
| 巡检任务 | `inspection` | 巡检任务 | 任务编号、巡检区域、巡检人员 |
| 缺陷记录 | `defect` | 缺陷记录 | 缺陷编号、所属管线、缺陷类型 |
| 外出维修 | `out_repair` | 外出维修 | 派遣编号、缺陷来源、维修人员 |
| 维修验收 | `repair_accept` | 维修验收记录 | 验收编号、关联维修、验收人员 |
| 管道检测 | `pipe_detect` | 检测记录 | 检测编号、检测管段、检测方式 |
| 井盖设施 | `manhole` | 井盖设施 | 井盖编号、所属道路、井盖类型 |
| 泵站运行 | `pump_station` | 泵站 | 泵站编号、泵站名称、所在区域 |
| 排水管网 | `drain_network` | 排水管段 | 管段编号、上游节点、下游节点 |
| 水质监测 | `water_quality` | 水质监测记录 | 监测编号、取样点位、取样日期 |
| 流量监测 | `flow_monitor` | 流量监测点 | 监测点编号、监测点位、监测时段 |
| 应急事件 | `emergency` | 应急事件 | 事件编号、事件类型、事发地点 |
| 漏水检测 | `leak_detect` | 漏水检测记录 | 检测编号、检测管段、检测方法 |
| 非开挖修复 | `trenchless` | 非开挖修复记录 | 修复编号、修复管段、修复工艺 |
| 管道清洗 | `pipe_cleaning` | 管道清洗记录 | 清洗编号、清洗管段、清洗方式 |
| 设施档案 | `facility_archive` | 设施档案 | 档案编号、设施名称、设施类别 |
| 监测设备 | `monitor_device` | 监测设备 | 设备编号、设备类型、安装位置 |
| 施工队伍 | `contractor` | 施工队伍 | 队伍编号、队伍名称、资质等级 |

## 约定

- 每个模块的页面在 `frontend/src/views/<模块>/index.vue`，页面只负责渲染，读写统一走
  `frontend/src/api/local-service.ts`。
- 字段、状态、动作与流转目标集中在 `frontend/src/data/modules.ts`；示例数据在
  `frontend/src/data/seed.ts`。
- 状态流转只允许在 `local-service.ts` 里改，页面组件不做业务判断。
- 想回到初始数据：清掉浏览器里 `underground-pipeline-inspection:entries` 这一项，或调用 `resetModule(模块)`。

## 施工队伍资质文件归档包

入口：左侧导航「资质文件归档」（`/contractor/qualification`），或施工队伍清单每行的「下载归档包」。

业务规则（纯前端实现，读写走 `src/api/qualification-service.ts`，校验规则在 `src/api/qualification-rules.ts`）：

- **打包下载**：归档包含队伍编号、资质等级、特种作业证要求、所属企业及三个补件槽位（资质等级证书、
  特种作业操作证、所属企业材料），下载为 UTF-8 JSON；审核人补充后可在页面「导入归档包上传」回导。
- **补充上传与逐条校验**：上传向导分 5 步（接收归档包 → 三份材料 → 提交），每份证件逐条校验
  有效期（支持"长期"）、作业范围（资质证书须覆盖排水/管网/市政，特种证须覆盖有限空间）、所属企业一致。
- **去重备案**：文件按 SHA-256 指纹判重，重复文件跳过，全重复时**不生成第二份备案记录**；
  每次上传只升一版，旧资质按历史版本保留可查；当前有效材料按槽位取各槽位最新一份。
- **准入联动**：通用动作流里「安排作业」前过资质闸门，资质过期或证照缺失直接拦截；
  作业中队伍触发过期/缺失时生成「退场核查事项」（同队伍同原因待核查事项不重复生成，可闭环后再巡检生成）。
- **断点续传**：上传会话逐步持久化在 localStorage（键 `underground-pipeline-inspection:qualification`），
  中断后步骤条标出完成到哪一步，续传从第一个失败/待办条目继续，已完成条目不重传；向导里提供
  「模拟本条目传输失败」开关演示该流程。

资质数据独立存储，页面上有「重置资质数据」回到示例。命令行可跑业务规则冒烟测试：

```bash
cd frontend
npm run smoke:qualification
```
