// =============================================================
// 档案选项卡 — 学生基本信息编辑表单
// 分组展示基础信息/联系方式/家庭/健康/在校/奖惩/备注/EAA元数据
// =============================================================

import type { EAAStudent, StudentProfileData } from '@shared/types'
import {
  FileText,
  GraduationCap,
  HeartPulse,
  Home,
  Phone,
  Settings,
  Trophy,
  User,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useAutoDismiss } from '../../../hooks/useAutoDismiss'
import { getAPI } from '../../../lib/ipc-client'
import { btnStyle } from '../../../lib/ui-utils'
import { InfoRow, ProfileField, ProfileSection } from '../components'

export function ProfileTab({
  student,
  profileData,
  onUpdate,
}: {
  student: EAAStudent
  profileData: StudentProfileData
  onUpdate: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<StudentProfileData>(profileData)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const setMsgAuto = useAutoDismiss<string>(setMsg, '')

  useEffect(() => {
    setForm(profileData)
  }, [profileData])

  const handleSave = async () => {
    setSaving(true)
    try {
      const result = await getAPI().profile.set(student.name, form)
      if (!result.success) {
        setMsgAuto(`保存失败: ${result.error ?? '未知错误'}`)
        return
      }
      // 同步 EAA class_id: 有值则设置, 空值则清空 (修复: 之前清空时不触发 --clear-class-id)
      if (form.classId) {
        await getAPI().eaa.setStudentMeta({ name: student.name, classId: form.classId as string })
      } else {
        await getAPI().eaa.setStudentMeta({ name: student.name, clearClassId: true })
      }
      setMsgAuto('档案已保存')
      onUpdate()
    } catch (err) {
      setMsgAuto(`保存失败: ${err instanceof Error ? err.message : String(err)}`)
    }
    setSaving(false)
    setEditing(false)
  }

  const updateForm = (key: string, value: string) => setForm((f) => ({ ...f, [key]: value }))

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">学生档案</h4>
        <button
          type="button"
          onClick={() => (editing ? handleSave() : setEditing(true))}
          disabled={saving}
          className={btnStyle('primary')}
        >
          {saving ? '保存中...' : editing ? '💾 保存' : '✏️ 编辑'}
        </button>
      </div>
      {msg && (
        <div className={`text-xs ${msg.includes('失败') ? 'text-red-500' : 'text-green-500'}`}>
          {msg}
        </div>
      )}

      {/* 基础信息 */}
      <ProfileSection title="基础信息" icon={<User size={16} />}>
        <div className="grid grid-cols-2 gap-3">
          <ProfileField label="姓名" value={student.name} editing={false} />
          <ProfileField
            label="性别"
            value={form.gender ?? ''}
            editing={editing}
            type="select"
            options={['男', '女']}
            onChange={(v) => updateForm('gender', v)}
          />
          <ProfileField
            label="出生日期"
            value={form.birthDate ?? ''}
            editing={editing}
            type="date"
            onChange={(v) => updateForm('birthDate', v)}
          />
          <ProfileField
            label="身份证号"
            value={form.idCard ?? ''}
            editing={editing}
            onChange={(v) => updateForm('idCard', v)}
          />
          <ProfileField
            label="班级"
            value={(form.classId as string) ?? student.class_id ?? ''}
            editing={editing}
            onChange={(v) => updateForm('classId', v)}
          />
          <ProfileField
            label="入学日期"
            value={form.enrollmentDate ?? ''}
            editing={editing}
            type="date"
            onChange={(v) => updateForm('enrollmentDate', v)}
          />
        </div>
      </ProfileSection>

      {/* 联系方式 */}
      <ProfileSection title="联系方式" icon={<Phone size={16} />}>
        <div className="grid grid-cols-2 gap-3">
          <ProfileField
            label="电话"
            value={form.phone ?? ''}
            editing={editing}
            onChange={(v) => updateForm('phone', v)}
          />
          <ProfileField
            label="邮箱"
            value={(form.email as string) ?? ''}
            editing={editing}
            onChange={(v) => updateForm('email', v)}
          />
          <ProfileField
            label="家庭住址"
            value={form.address ?? ''}
            editing={editing}
            onChange={(v) => updateForm('address', v)}
            spanFull
          />
        </div>
      </ProfileSection>

      {/* 家庭信息 */}
      <ProfileSection title="家庭信息" icon={<Home size={16} />}>
        <div className="grid grid-cols-2 gap-3">
          <ProfileField
            label="父亲姓名"
            value={(form.fatherName as string) ?? ''}
            editing={editing}
            onChange={(v) => updateForm('fatherName', v)}
          />
          <ProfileField
            label="父亲电话"
            value={(form.fatherPhone as string) ?? ''}
            editing={editing}
            onChange={(v) => updateForm('fatherPhone', v)}
          />
          <ProfileField
            label="母亲姓名"
            value={(form.motherName as string) ?? ''}
            editing={editing}
            onChange={(v) => updateForm('motherName', v)}
          />
          <ProfileField
            label="母亲电话"
            value={(form.motherPhone as string) ?? ''}
            editing={editing}
            onChange={(v) => updateForm('motherPhone', v)}
          />
        </div>
      </ProfileSection>

      {/* 健康信息 */}
      <ProfileSection title="健康信息" icon={<HeartPulse size={16} />}>
        <div className="grid grid-cols-2 gap-3">
          <ProfileField
            label="血型"
            value={(form.bloodType as string) ?? ''}
            editing={editing}
            type="select"
            options={['A', 'B', 'AB', 'O']}
            onChange={(v) => updateForm('bloodType', v)}
          />
          <ProfileField
            label="过敏史"
            value={(form.allergy as string) ?? ''}
            editing={editing}
            onChange={(v) => updateForm('allergy', v)}
          />
          <ProfileField
            label="特殊需求"
            value={(form.specialNeeds as string) ?? ''}
            editing={editing}
            onChange={(v) => updateForm('specialNeeds', v)}
            spanFull
          />
        </div>
      </ProfileSection>

      {/* 在校信息 */}
      <ProfileSection title="在校信息" icon={<GraduationCap size={16} />}>
        <div className="grid grid-cols-2 gap-3">
          <ProfileField
            label="学号"
            value={(form.studentNumber as string) ?? ''}
            editing={editing}
            onChange={(v) => updateForm('studentNumber', v)}
          />
          <ProfileField
            label="宿舍号"
            value={(form.dormNumber as string) ?? ''}
            editing={editing}
            onChange={(v) => updateForm('dormNumber', v)}
          />
          <ProfileField
            label="床号"
            value={(form.bedNumber as string) ?? ''}
            editing={editing}
            onChange={(v) => updateForm('bedNumber', v)}
          />
          <ProfileField
            label="出勤率(%)"
            value={form.attendanceRate?.toString() ?? ''}
            editing={editing}
            type="number"
            onChange={(v) => updateForm('attendanceRate', v)}
          />
        </div>
      </ProfileSection>

      {/* 奖惩记录 */}
      <ProfileSection title="奖惩记录" icon={<Trophy size={16} />}>
        <div className="grid grid-cols-1 gap-3">
          <ProfileField
            label="荣誉称号"
            value={(form.honors as string) ?? ''}
            editing={editing}
            multiline
            onChange={(v) => updateForm('honors', v)}
            spanFull
          />
          <ProfileField
            label="处分记录"
            value={(form.punishments as string) ?? ''}
            editing={editing}
            multiline
            onChange={(v) => updateForm('punishments', v)}
            spanFull
          />
        </div>
      </ProfileSection>

      {/* 备注 */}
      <ProfileSection title="备注" icon={<FileText size={16} />}>
        <ProfileField
          label=""
          value={form.comments ?? ''}
          editing={editing}
          multiline
          onChange={(v) => updateForm('comments', v)}
          spanFull
        />
      </ProfileSection>

      {/* EAA 元数据 */}
      <ProfileSection title="EAA 系统数据" icon={<Settings size={16} />}>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <InfoRow label="分组" value={student.groups.join(', ') || '无'} />
          <InfoRow label="角色" value={student.roles.join(', ') || '无'} />
          <InfoRow label="状态" value={student.status} />
        </div>
      </ProfileSection>
    </div>
  )
}
