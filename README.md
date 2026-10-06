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
│   │   └── qualification/    资质归档包：类型 / 种子 / 存储 / ZIP / 业务规则
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
| 资质文件归档 | `qualification` | 资质归档包/备案记录/退场核查事项 | 队伍编号、资质等级、特种作业证、所属企业材料 |

### 资质文件归档包规则

`资质文件归档`（`frontend/src/views/qualification/`）围绕施工队伍资质做闭环管理，业务规则全部收敛在
`frontend/src/data/qualification/qualification-service.ts`：

- **打包下载**：把队伍编号、资质等级、特种作业证、所属企业材料四类材料（附归档说明与 manifest）打成
  ZIP 下载（零依赖 ZIP 生成，见 `data/qualification/zip.ts`），审核人补充证件信息后再上传。
- **逐条校验**：上传按固定四步进行，系统逐条校验证件有效期（过期/格式）、作业范围（须覆盖管网施工养护）、
  所属企业（须与队伍登记企业一致）以及队伍编号一致性。
- **重复去重**：整包文件与现行备案一致时不生成第二份备案记录；内容有变才追加版本，旧资质整包快照
  按历史版本永久保留（备案记录按队伍唯一）。
- **作业联动**：资质过期或证照缺失时不能审核备案、不能安排作业；已经在作业中的队伍自动生成
  「退场核查事项」（幂等不重复开单），确认退场后联动施工队伍清退。
- **断点续传**：上传中断会标出完成到第几步并持久化会话，可从中断/失败条目继续，已通过的步骤不重传。

## 约定

- 每个模块的页面在 `frontend/src/views/<模块>/index.vue`，页面只负责渲染，读写统一走
  `frontend/src/api/local-service.ts`。
- 字段、状态、动作与流转目标集中在 `frontend/src/data/modules.ts`；示例数据在
  `frontend/src/data/seed.ts`。
- 状态流转只允许在 `local-service.ts` 里改，页面组件不做业务判断；资质归档相关流转在
  `data/qualification/qualification-service.ts`。
- 想回到初始数据：清掉浏览器里 `underground-pipeline-inspection:entries` 和
  `underground-pipeline-inspection:qualification` 两项，或调用 `resetModule(模块)`。
  调整示例数据时抬升 `local-store.ts` 里的 `SEED_VERSION`，旧缓存会自动重建。
