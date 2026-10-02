<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { NButton, NCard, NInput, NSpace, NModal, NGrid, NGridItem, NIcon, NPopconfirm } from 'naive-ui'

const router = useRouter()
const projects = ref<Array<{ name: string; modifiedAt: string }>>([])
const newName = ref('')
const showNewModal = ref(false)
const loading = ref(false)

async function fetchProjects() {
  try {
    const resp = await fetch('/api/projects')
    projects.value = await resp.json()
  } catch { projects.value = [] }
}

onMounted(fetchProjects)

async function createProject() {
  const name = newName.value.trim()
  if (!name) return
  loading.value = true
  try {
    const resp = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    if (!resp.ok) {
      const err = await resp.json()
      alert(err.error || '创建失败')
      return
    }
    const project = await resp.json()
    showNewModal.value = false
    newName.value = ''
    router.push(`/project/${project.name}`)
  } finally { loading.value = false }
}

function openProject(name: string) {
  router.push(`/project/${name}`)
}

async function deleteProject(name: string) {
  await fetch(`/api/projects/${name}`, { method: 'DELETE' })
  fetchProjects()
}

function importProject() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.asvcproj,application/json'
  input.onchange = async () => {
    const file = input.files?.[0]
    if (!file) return
    try {
      const text = await file.text()
      const data = JSON.parse(text)
      const resp = await fetch('/api/projects/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!resp.ok) { alert('导入失败'); return }
      const result = await resp.json()
      router.push(`/project/${result.name}`)
    } catch (e: any) {
      alert('无法读取项目文件: ' + e.message)
    }
  }
  input.click()
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('zh-CN')
}
</script>

<template>
  <div class="home-root">
    <div class="home-header">
      <h1 class="home-title"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 20 7.5v9L12 21l-8-4.5v-9L12 3Zm0 2.3L6 8.7v6.6l6 3.4 6-3.4V8.7l-6-3.4Zm0 3.2a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7Z" /></svg>AISVC Midi</h1>
      <p class="home-subtitle">歌词转歌声合成工作站</p>
    </div>

    <div class="home-actions">
      <n-button type="primary" size="large" @click="showNewModal = true"><span class="btn-icon"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 4h5l1 1h6v7H2V4Z" /></svg></span>新建项目</n-button>
      <n-button size="large" @click="importProject"><span class="btn-icon"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M7.5 2h1v6.2l2.2-2.2.7.7L8 10.1 4.6 6.7l.7-.7 2.2 2.2V2ZM3 12h10v2H3v-2Z" /></svg></span>导入项目</n-button>
    </div>

    <div class="home-projects" v-if="projects.length > 0">
      <h3>最近项目</h3>
      <n-grid :cols="3" :x-gap="16" :y-gap="16">
        <n-grid-item v-for="p in projects" :key="p.name">
          <n-card hoverable @click="openProject(p.name)">
            <div class="project-card-content">
              <span class="project-icon"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 4h5l1 1h6v7H2V4Z" /></svg></span>
              <span class="project-name">{{ p.name }}</span>
            </div>
            <template #footer>
              <div class="project-footer">
                <span class="project-date">{{ formatDate(p.modifiedAt) }}</span>
                <n-popconfirm @positive-click="deleteProject(p.name)">
                  <template #trigger>
                    <n-button text size="tiny" type="error" @click.stop>删除</n-button>
                  </template>
                  确定删除项目「{{ p.name }}」？
                </n-popconfirm>
              </div>
            </template>
          </n-card>
        </n-grid-item>
      </n-grid>
    </div>

    <div class="home-empty" v-else>
      <p>还没有项目，新建一个或导入外部项目文件开始</p>
    </div>

    <n-modal v-model:show="showNewModal" preset="card" title="新建项目" style="width: 400px">
      <n-space vertical>
        <n-input v-model:value="newName" placeholder="输入项目名称" @keyup.enter="createProject" />
        <n-button type="primary" :loading="loading" block @click="createProject">创建</n-button>
      </n-space>
    </n-modal>
  </div>
</template>

<style scoped>
.home-root {
  height: 100vh;
  overflow: auto;
  background: linear-gradient(135deg, #0B0E14 0%, #1a1f2e 100%);
  color: var(--app-text);
  padding: 60px 80px;
  position: relative;
}
.home-root::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 400px;
  background: radial-gradient(ellipse at top, rgba(34, 211, 238, 0.15), transparent 70%);
  pointer-events: none;
}
.home-header { text-align: center; margin-bottom: 48px; position: relative; z-index: 1; }
.home-title {
  font-size: 42px;
  margin: 0;
  color: var(--app-text);
  display: inline-flex;
  align-items: center;
  gap: 12px;
  font-weight: 700;
  letter-spacing: -0.02em;
}
.home-title svg {
  width: 40px;
  height: 40px;
  fill: var(--app-accent);
  filter: drop-shadow(0 0 12px rgba(34, 211, 238, 0.4));
}
.home-subtitle {
  font-size: 17px;
  color: var(--app-muted);
  margin-top: 10px;
  font-weight: 400;
}
.home-actions {
  display: flex;
  gap: 16px;
  justify-content: center;
  margin-bottom: 56px;
  position: relative;
  z-index: 1;
}
.home-projects {
  position: relative;
  z-index: 1;
}
.home-projects h3 {
  margin-bottom: 20px;
  font-size: 18px;
  color: var(--app-muted);
  font-weight: 600;
  letter-spacing: -0.01em;
}
.project-card-content {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 16px;
  transition: transform 0.2s ease;
}
.project-icon {
  display: inline-flex;
  color: var(--app-accent);
  opacity: 0.8;
}
.project-icon svg { width: 24px; height: 24px; fill: currentColor; }
.btn-icon { display: inline-flex; margin-right: 6px; vertical-align: -2px; }
.btn-icon svg { width: 16px; height: 16px; fill: currentColor; }
.project-name {
  color: var(--app-text);
  font-weight: 500;
}
.project-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-top: 4px;
}
.project-date {
  font-size: 12px;
  color: var(--app-muted);
  font-variant-numeric: tabular-nums;
}
.home-empty {
  text-align: center;
  padding: 80px 0;
  color: var(--app-muted);
  font-size: 16px;
  position: relative;
  z-index: 1;
}
:deep(.n-card) {
  background: var(--app-panel);
  border: 1px solid var(--app-border);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s ease;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}
:deep(.n-card:hover) {
  border-color: var(--app-accent);
  transform: translateY(-2px);
  box-shadow: 0 4px 16px rgba(34, 211, 238, 0.15);
}
:deep(.n-button) {
  transition: all 0.2s ease;
}
:deep(.n-button:hover) {
  transform: translateY(-1px);
}
</style>
