'use client';

/**
 * 首页对话框集合（自 `app/page.tsx` 抽取，行为不变）。
 *
 * 纯展示 + 回调：弹窗开关状态与业务处理仍由首页持有，本组件只负责弹窗结构与表单绑定，
 * 使首页文件专注于列表与场景/本体操作编排。
 */
import { Modal, Input } from 'antd';

/** 场景表单（新建/编辑共用字段） */
interface ScenarioForm {
  open: boolean;
  name: string;
  desc: string;
  setName: (v: string) => void;
  setDesc: (v: string) => void;
  close: () => void;
  submit: () => void;
}

/** 本体表单（比场景多一个创建人） */
interface OntologyForm {
  open: boolean;
  name: string;
  desc: string;
  creator: string;
  setName: (v: string) => void;
  setDesc: (v: string) => void;
  setCreator: (v: string) => void;
  close: () => void;
  submit: () => void;
}

/** 删除本体确认（需输入名称二次确认） */
interface DeleteOntologyForm {
  open: boolean;
  name: string;
  confirmText: string;
  setConfirmText: (v: string) => void;
  close: () => void;
  submit: () => void;
}

export interface HomeDialogsProps {
  newScenario: ScenarioForm;
  newOntology: OntologyForm;
  editScenario: ScenarioForm;
  editOntology: OntologyForm;
  deleteOntology: DeleteOntologyForm;
}

export default function HomeDialogs({
  newScenario, newOntology, editScenario, editOntology, deleteOntology,
}: HomeDialogsProps) {
  return (
    <>
      {/* New Scenario */}
      <Modal
        title="新建业务场景"
        open={newScenario.open}
        onOk={newScenario.submit}
        onCancel={newScenario.close}
        okText="创建"
        cancelText="取消"
      >
        <div className="space-y-3 pt-2">
          <div>
            <label className="text-text-secondary text-sm block mb-1">业务场景名称 *</label>
            <Input
              placeholder="请输入业务场景名称"
              value={newScenario.name}
              onChange={e => newScenario.setName(e.target.value)}
              className="bg-dark-bg border-dark-border text-text-primary"
            />
          </div>
          <div>
            <label className="text-text-secondary text-sm block mb-1">业务场景描述</label>
            <Input.TextArea
              placeholder="请输入业务场景描述（可选）"
              value={newScenario.desc}
              onChange={e => newScenario.setDesc(e.target.value)}
              rows={3}
              className="bg-dark-bg border-dark-border text-text-primary"
            />
          </div>
        </div>
      </Modal>

      {/* New Ontology */}
      <Modal
        title="新建本体"
        open={newOntology.open}
        onOk={newOntology.submit}
        onCancel={newOntology.close}
        okText="创建并设计"
        cancelText="取消"
      >
        <div className="space-y-3 pt-2">
          <div>
            <label className="text-text-secondary text-sm block mb-1">本体名称 *</label>
            <Input
              placeholder="请输入本体名称"
              value={newOntology.name}
              onChange={e => newOntology.setName(e.target.value)}
              className="bg-dark-bg border-dark-border text-text-primary"
            />
          </div>
          <div>
            <label className="text-text-secondary text-sm block mb-1">本体描述</label>
            <Input.TextArea
              placeholder="请输入本体描述（可选）"
              value={newOntology.desc}
              onChange={e => newOntology.setDesc(e.target.value)}
              rows={3}
              className="bg-dark-bg border-dark-border text-text-primary"
            />
          </div>
          <div>
            <label className="text-text-secondary text-sm block mb-1">创建人</label>
            <Input
              placeholder="请输入创建人（可选）"
              value={newOntology.creator}
              onChange={e => newOntology.setCreator(e.target.value)}
              className="bg-dark-bg border-dark-border text-text-primary"
            />
          </div>
        </div>
      </Modal>

      {/* Edit Scenario */}
      <Modal
        title="编辑业务场景"
        open={editScenario.open}
        onOk={editScenario.submit}
        onCancel={editScenario.close}
        okText="保存"
        cancelText="取消"
      >
        <div className="space-y-3 pt-2">
          <div>
            <label className="text-text-secondary text-sm block mb-1">业务场景名称 *</label>
            <Input
              placeholder="请输入业务场景名称"
              value={editScenario.name}
              onChange={e => editScenario.setName(e.target.value)}
              className="bg-dark-bg border-dark-border text-text-primary"
            />
          </div>
          <div>
            <label className="text-text-secondary text-sm block mb-1">业务场景描述</label>
            <Input.TextArea
              placeholder="请输入业务场景描述"
              value={editScenario.desc}
              onChange={e => editScenario.setDesc(e.target.value)}
              rows={3}
              className="bg-dark-bg border-dark-border text-text-primary"
            />
          </div>
        </div>
      </Modal>

      {/* Edit Ontology */}
      <Modal
        title="编辑本体"
        open={editOntology.open}
        onOk={editOntology.submit}
        onCancel={editOntology.close}
        okText="保存"
        cancelText="取消"
      >
        <div className="space-y-3 pt-2">
          <div>
            <label className="text-text-secondary text-sm block mb-1">本体名称 *</label>
            <Input
              placeholder="请输入本体名称"
              value={editOntology.name}
              onChange={e => editOntology.setName(e.target.value)}
              className="bg-dark-bg border-dark-border text-text-primary"
            />
          </div>
          <div>
            <label className="text-text-secondary text-sm block mb-1">本体描述</label>
            <Input.TextArea
              placeholder="请输入本体描述"
              value={editOntology.desc}
              onChange={e => editOntology.setDesc(e.target.value)}
              rows={3}
              className="bg-dark-bg border-dark-border text-text-primary"
            />
          </div>
          <div>
            <label className="text-text-secondary text-sm block mb-1">创建人</label>
            <Input
              placeholder="请输入创建人"
              value={editOntology.creator}
              onChange={e => editOntology.setCreator(e.target.value)}
              className="bg-dark-bg border-dark-border text-text-primary"
            />
          </div>
        </div>
      </Modal>

      {/* Confirm Delete Ontology */}
      <Modal
        title="确认删除本体"
        open={deleteOntology.open}
        onOk={deleteOntology.submit}
        onCancel={deleteOntology.close}
        okText="确认删除"
        cancelText="取消"
        okButtonProps={{ danger: true }}
      >
        <div className="space-y-3 pt-2">
          <p className="text-text-secondary text-sm">
            删除本体 <strong className="text-red-400">{deleteOntology.name}</strong> 将同时删除其所有数据，
            此操作不可撤回。请输入本体名称以确认：
          </p>
          <Input
            placeholder={`请输入 "${deleteOntology.name}" 确认删除`}
            value={deleteOntology.confirmText}
            onChange={e => deleteOntology.setConfirmText(e.target.value)}
            className="bg-dark-bg border-dark-border text-text-primary"
          />
        </div>
      </Modal>
    </>
  );
}
