import type { ArchiveDoc, ExitCheck, QualificationRecord } from './types'

// 资质示例数据：队2资质齐全有效；队3特种作业证已过期（2026-09-30），作业中需生成退场核查。
function doc(
  kind: ArchiveDoc['kind'],
  certNo: string,
  validUntil: string,
  workScope: string,
  company: string,
  fileHash: string,
  uploadedAt: string,
): ArchiveDoc {
  return {
    kind,
    certNo,
    validUntil,
    workScope,
    company,
    fileName: `${kind}-${certNo}.pdf`,
    fileSize: 248 * 1024,
    fileHash,
    uploadedAt,
  }
}

export const QUALIFICATION_SEED_RECORDS: QualificationRecord[] = [
  {
    id: 1,
    recordNo: 'ZGBA-0001',
    teamId: 2,
    teamCode: 'CONT-0002',
    teamName: '宁通市政管道工程队',
    currentVersion: 1,
    reviewer: '审核人-王敏',
    filedAt: '2026-08-12 09:40',
    snapshot: {
      grade: '市政公用工程施工总承包贰级',
      company: '宁通市政工程有限公司',
      scope: '排水管网养护维修、有限空间作业、井下检测',
      docs: {
        队伍编号: doc(
          '队伍编号',
          'CONT-0002',
          '长期',
          '排水管网养护维修',
          '宁通市政工程有限公司',
          'seed-team-0002',
          '2026-08-11 16:20',
        ),
        资质等级: doc(
          '资质等级',
          'SGZZ-2024-0231',
          '长期',
          '排水管网施工、养护维修',
          '宁通市政工程有限公司',
          'seed-grade-0002',
          '2026-08-11 16:22',
        ),
        特种作业证: doc(
          '特种作业证',
          'TZ-3206-557812',
          '2028-06-30',
          '有限空间作业、井下特种作业',
          '宁通市政工程有限公司',
          'seed-special-0002',
          '2026-08-11 16:24',
        ),
        所属企业材料: doc(
          '所属企业材料',
          '91320100MA1N8T2X4K',
          '长期',
          '市政公用工程施工、排水管网养护维修',
          '宁通市政工程有限公司',
          'seed-company-0002',
          '2026-08-11 16:26',
        ),
      },
    },
    history: [],
  },
  {
    id: 2,
    recordNo: 'ZGBA-0002',
    teamId: 3,
    teamCode: 'CONT-0003',
    teamName: '弘基非开挖修复施工队',
    currentVersion: 1,
    reviewer: '审核人-王敏',
    filedAt: '2026-03-20 10:05',
    snapshot: {
      grade: '市政公用工程施工总承包叁级',
      company: '弘基建设工程有限公司',
      scope: '非开挖修复、管道检测',
      docs: {
        队伍编号: doc(
          '队伍编号',
          'CONT-0003',
          '长期',
          '非开挖修复',
          '弘基建设工程有限公司',
          'seed-team-0003',
          '2026-03-19 14:10',
        ),
        资质等级: doc(
          '资质等级',
          'SGZZ-2023-0917',
          '2028-03-14',
          '非开挖修复、管道检测',
          '弘基建设工程有限公司',
          'seed-grade-0003',
          '2026-03-19 14:12',
        ),
        特种作业证: doc(
          '特种作业证',
          'TZ-3205-442109',
          '2026-09-30',
          '井下特种作业、管道检测',
          '弘基建设工程有限公司',
          'seed-special-0003',
          '2026-03-19 14:14',
        ),
        所属企业材料: doc(
          '所属企业材料',
          '91320500MA1Q7K9B2T',
          '长期',
          '非开挖修复、管道检测',
          '弘基建设工程有限公司',
          'seed-company-0003',
          '2026-03-19 14:16',
        ),
      },
    },
    history: [],
  },
]

export const QUALIFICATION_SEED_EXIT_CHECKS: ExitCheck[] = [
  {
    id: 'TC-0001',
    teamId: 3,
    teamCode: 'CONT-0003',
    teamName: '弘基非开挖修复施工队',
    reasons: ['特种作业证已过有效期（2026-09-30）'],
    source: '资质过期',
    createdAt: '2026-10-06 08:00',
    status: '待退场核查',
    handler: '',
  },
]
