import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'

const DAYS = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY']
const VIEW_MODES = ['current', 'timeline', 'widgets', 'templates']
const STORAGE_KEY = 'schedule_now_templates_v1'

function parseFullTime(value) {
  const match = value.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i)
  if (!match) {
    return null
  }

  const hour12 = Number(match[1])
  const minute = Number(match[2])
  const meridiem = match[3].toUpperCase()
  const hour24 = (hour12 % 12) + (meridiem === 'PM' ? 12 : 0)

  return { hour24, minute, hour12, meridiem }
}

function resolveTime(timeCell, lastTimeState) {
  const trimmed = timeCell.trim()
  const fullTime = parseFullTime(trimmed)

  if (fullTime) {
    return {
      minutes: fullTime.hour24 * 60 + fullTime.minute,
      nextTimeState: { hour12: fullTime.hour12, meridiem: fullTime.meridiem },
    }
  }

  const partial = trimmed.match(/^:(\d{2})$/)
  if (!partial || !lastTimeState) {
    return null
  }

  const minute = Number(partial[1])
  const hour24 = (lastTimeState.hour12 % 12) + (lastTimeState.meridiem === 'PM' ? 12 : 0)

  return {
    minutes: hour24 * 60 + minute,
    nextTimeState: lastTimeState,
  }
}

function buildScheduleMap(csvText) {
  const lines = csvText.split(/\r?\n/).filter((line) => line.trim().length > 0)
  const rows = lines.map((line) => line.split(',').map((cell) => cell.trim()))

  const headerIndex = rows.findIndex((row) => row.includes('SUNDAY'))
  if (headerIndex === -1) {
    return new Map()
  }

  const schedule = new Map()
  let lastTimeState = null

  for (let rowIndex = headerIndex + 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex]
    const timeCell = row[1] || ''
    if (!timeCell) {
      continue
    }

    const resolved = resolveTime(timeCell, lastTimeState)
    if (!resolved) {
      continue
    }

    lastTimeState = resolved.nextTimeState

    DAYS.forEach((day, dayIndex) => {
      const activity = (row[dayIndex + 2] || '').trim()
      if (!activity) {
        return
      }

      schedule.set(`${day}-${resolved.minutes}`, activity)
    })
  }

  return schedule
}

function minuteToLabel(minuteOfDay) {
  const hour24 = Math.floor(minuteOfDay / 60)
  const minute = minuteOfDay % 60
  const meridiem = hour24 >= 12 ? 'PM' : 'AM'
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12

  return `${String(hour12).padStart(2, '0')}:${String(minute).padStart(2, '0')} ${meridiem}`
}

function buildDayTimeline(day, schedule) {
  const slots = []

  for (let minute = 0; minute < 24 * 60; minute += 15) {
    slots.push({
      minute,
      timeText: minuteToLabel(minute),
      activity: schedule.get(`${day}-${minute}`) || 'No activity found for this slot.',
    })
  }

  return slots
}

function playNotificationSound() {
  const AudioCtx = window.AudioContext || window.webkitAudioContext
  if (!AudioCtx) {
    return
  }

  const ctx = new AudioCtx()
  const oscillator = ctx.createOscillator()
  const gainNode = ctx.createGain()

  oscillator.type = 'sine'
  oscillator.frequency.setValueAtTime(880, ctx.currentTime)
  gainNode.gain.setValueAtTime(0.001, ctx.currentTime)
  gainNode.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.03)
  gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35)

  oscillator.connect(gainNode)
  gainNode.connect(ctx.destination)

  oscillator.start()
  oscillator.stop(ctx.currentTime + 0.36)
  oscillator.onended = () => {
    ctx.close().catch(() => {})
  }
}

function mapToObject(map) {
  return Object.fromEntries(map.entries())
}

function objectToMap(value) {
  return new Map(Object.entries(value || {}))
}

function createTemplateId() {
  return `template-${Date.now()}-${Math.floor(Math.random() * 10000)}`
}

function App() {
  const [now, setNow] = useState(() => new Date())
  const [templates, setTemplates] = useState([])
  const [activeTemplateId, setActiveTemplateId] = useState('default-template')
  const [hydrated, setHydrated] = useState(false)

  const [viewMode, setViewMode] = useState('current')
  const [toast, setToast] = useState('')
  const [error, setError] = useState('')
  const [installPromptEvent, setInstallPromptEvent] = useState(null)
  const [isStandalone, setIsStandalone] = useState(false)

  const [editorDay, setEditorDay] = useState('SUNDAY')
  const [editorMinute, setEditorMinute] = useState(6 * 60)
  const [editorActivity, setEditorActivity] = useState('')
  const [newTemplateName, setNewTemplateName] = useState('')

  const lastSeenBlockRef = useRef(null)
  const hideToastTimerRef = useRef(null)

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    const standaloneMode =
      window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true
    setIsStandalone(standaloneMode)

    const handleBeforeInstallPrompt = (event) => {
      event.preventDefault()
      setInstallPromptEvent(event)
    }

    const handleAppInstalled = () => {
      setInstallPromptEvent(null)
      setIsStandalone(true)
      showToast('App installed successfully.')
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
    window.addEventListener('appinstalled', handleAppInstalled)

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
      window.removeEventListener('appinstalled', handleAppInstalled)
    }
  }, [])

  useEffect(() => {
    let mounted = true

    async function loadScheduleAndTemplates() {
      try {
        const response = await fetch('/Schedule.csv')
        if (!response.ok) {
          throw new Error('Could not load schedule file.')
        }

        const csvText = await response.text()
        if (!mounted) {
          return
        }

        const defaultTemplate = {
          id: 'default-template',
          name: 'Default',
          schedule: mapToObject(buildScheduleMap(csvText)),
        }

        const rawSaved = localStorage.getItem(STORAGE_KEY)
        if (!rawSaved) {
          setTemplates([defaultTemplate])
          setActiveTemplateId(defaultTemplate.id)
          setHydrated(true)
          return
        }

        const saved = JSON.parse(rawSaved)
        if (!saved || !Array.isArray(saved.templates) || saved.templates.length === 0) {
          setTemplates([defaultTemplate])
          setActiveTemplateId(defaultTemplate.id)
          setHydrated(true)
          return
        }

        const hasDefault = saved.templates.some((template) => template.id === 'default-template')
        const mergedTemplates = hasDefault
          ? saved.templates.map((template) =>
              template.id === 'default-template' ? { ...template, name: 'Default' } : template
            )
          : [defaultTemplate, ...saved.templates]

        setTemplates(mergedTemplates)
        setActiveTemplateId(saved.activeTemplateId || mergedTemplates[0].id)
        setHydrated(true)
      } catch (loadError) {
        if (!mounted) {
          return
        }

        setError(loadError instanceof Error ? loadError.message : 'Unknown schedule loading error.')
        setHydrated(true)
      }
    }

    loadScheduleAndTemplates()

    return () => {
      mounted = false
    }
  }, [])

  useEffect(() => {
    if (!hydrated || templates.length === 0) {
      return
    }

    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        templates,
        activeTemplateId,
      })
    )
  }, [templates, activeTemplateId, hydrated])

  useEffect(
    () => () => {
      if (hideToastTimerRef.current) {
        window.clearTimeout(hideToastTimerRef.current)
      }
    },
    []
  )

  const activeTemplate = useMemo(() => {
    if (templates.length === 0) {
      return null
    }
    return templates.find((template) => template.id === activeTemplateId) || templates[0]
  }, [templates, activeTemplateId])

  const schedule = useMemo(() => {
    if (!activeTemplate) {
      return new Map()
    }
    return objectToMap(activeTemplate.schedule)
  }, [activeTemplate])

  const status = useMemo(() => {
    const day = DAYS[now.getDay()]
    const minutes = now.getHours() * 60 + now.getMinutes()
    const blockMinute = Math.floor(minutes / 15) * 15
    const nextBlockMinute = (blockMinute + 15) % 1440

    const currentActivity = schedule.get(`${day}-${blockMinute}`) || 'No activity found for this slot.'
    const nextActivity = schedule.get(`${day}-${nextBlockMinute}`) || 'No next activity found.'

    return {
      day,
      blockMinute,
      nextBlockMinute,
      currentTimeText: now.toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }),
      currentBlockText: now.toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      }),
      currentActivity,
      nextActivity,
    }
  }, [now, schedule])

  const timelineSlots = useMemo(() => buildDayTimeline(status.day, schedule), [status.day, schedule])
  const slotValue = schedule.get(`${editorDay}-${editorMinute}`) || ''

  useEffect(() => {
    if (schedule.size === 0 || !activeTemplate) {
      return
    }

    const blockKey = `${activeTemplate.id}-${status.day}-${status.blockMinute}`
    if (lastSeenBlockRef.current === null) {
      lastSeenBlockRef.current = blockKey
      return
    }

    if (lastSeenBlockRef.current === blockKey) {
      return
    }

    lastSeenBlockRef.current = blockKey

    const message = `New block started: ${status.currentActivity}`
    setToast(message)
    playNotificationSound()

    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification('Schedule Update', { body: message })
    }

    if (hideToastTimerRef.current) {
      window.clearTimeout(hideToastTimerRef.current)
    }

    hideToastTimerRef.current = window.setTimeout(() => {
      setToast('')
    }, 7000)
  }, [schedule, status.day, status.blockMinute, status.currentActivity, activeTemplate])

  const showToast = (message) => {
    setToast(message)
    if (hideToastTimerRef.current) {
      window.clearTimeout(hideToastTimerRef.current)
    }

    hideToastTimerRef.current = window.setTimeout(() => {
      setToast('')
    }, 4000)
  }

  const updateActiveTemplateSchedule = (updater) => {
    if (!activeTemplate) {
      return
    }

    setTemplates((prev) =>
      prev.map((template) => {
        if (template.id !== activeTemplate.id) {
          return template
        }

        const workingSchedule = objectToMap(template.schedule)
        updater(workingSchedule)

        return {
          ...template,
          schedule: mapToObject(workingSchedule),
        }
      })
    )
  }

  const saveEditedActivity = () => {
    const trimmed = editorActivity.trim()
    if (!trimmed) {
      showToast('Type an activity before saving.')
      return
    }

    updateActiveTemplateSchedule((workingSchedule) => {
      workingSchedule.set(`${editorDay}-${editorMinute}`, trimmed)
    })
    setEditorActivity('')
    showToast(`Saved ${minuteToLabel(editorMinute)} on ${editorDay}.`)
  }

  const clearEditedActivity = () => {
    updateActiveTemplateSchedule((workingSchedule) => {
      workingSchedule.delete(`${editorDay}-${editorMinute}`)
    })
    showToast(`Cleared ${minuteToLabel(editorMinute)} on ${editorDay}.`)
  }

  const createTemplateFromCurrent = () => {
    if (!activeTemplate) {
      return
    }

    const name = newTemplateName.trim() || `Template ${templates.length + 1}`
    const template = {
      id: createTemplateId(),
      name,
      schedule: { ...activeTemplate.schedule },
    }

    setTemplates((prev) => [...prev, template])
    setActiveTemplateId(template.id)
    setNewTemplateName('')
    showToast(`Created template: ${name}`)
  }

  const removeTemplate = (templateId) => {
    if (templates.length <= 1) {
      showToast('At least one template must remain.')
      return
    }

    const confirmed = window.confirm('Delete this template?')
    if (!confirmed) {
      return
    }

    setTemplates((prev) => {
      const filtered = prev.filter((template) => template.id !== templateId)
      if (activeTemplateId === templateId) {
        setActiveTemplateId(filtered[0].id)
      }
      return filtered
    })
    showToast('Template removed.')
  }

  const useSlotInEditor = (slot) => {
    setEditorDay(status.day)
    setEditorMinute(slot.minute)
    setEditorActivity(slot.activity)
    setViewMode('templates')
    showToast('Loaded slot into editor.')
  }

  const dayProgress = Math.round(((status.blockMinute + 15) / 1440) * 100)
  const dayRemainingMinutes = 1440 - (status.blockMinute + 15)

  const enableNotifications = async () => {
    if (!('Notification' in window)) {
      showToast('Browser notifications are not supported on this device.')
      return
    }

    const permission = await Notification.requestPermission()
    if (permission === 'granted') {
      showToast('Browser notifications enabled.')
      return
    }

    showToast('Notifications were blocked. Sound and in-app popups still work.')
  }

  const installAsBrowserApp = async () => {
    if (isStandalone) {
      showToast('App is already installed.')
      return
    }

    if (!installPromptEvent) {
      showToast('Use browser menu: Install app / Create shortcut to install.')
      return
    }

    installPromptEvent.prompt()
    const choice = await installPromptEvent.userChoice
    if (choice.outcome === 'accepted') {
      showToast('Install accepted. Finishing setup...')
    } else {
      showToast('Install cancelled.')
    }
    setInstallPromptEvent(null)
  }

  return (
    <main className="app-shell">
      <section className="card top-card">
        <p className="label">Active Template</p>
        <div className="template-chips">
          {templates.map((template) => {
            const selected = template.id === activeTemplate?.id
            return (
              <button
                key={template.id}
                className={`template-chip ${selected ? 'template-chip-active' : ''}`.trim()}
                onClick={() => setActiveTemplateId(template.id)}
              >
                {template.name}
              </button>
            )
          })}
        </div>
      </section>

      {viewMode === 'current' ? (
        <>
          <section className="card">
            <p className="label">Current Time</p>
            <h1>{status.currentTimeText}</h1>
            <p className="day">{status.day}</p>
          </section>

          <section className="card focus-card">
            <p className="label">What You Should Do Right Now</p>
            <h2>{status.currentActivity}</h2>
            <p className="meta">Based on the {status.currentBlockText} time block</p>
          </section>

          <section className="card">
            <p className="label">Next 15-Minute Block</p>
            <p className="next">{status.nextActivity}</p>
          </section>
        </>
      ) : null}

      {viewMode === 'timeline' ? (
        <section className="card timeline-card">
          <p className="label">Full Day Timeline</p>
          <p className="meta">Tap any row to edit that slot in Templates mode.</p>
          <div className="timeline-list" aria-label="full day timeline">
            {timelineSlots.map((slot) => {
              const isCurrent = slot.minute === status.blockMinute
              const isNext = slot.minute === status.nextBlockMinute

              return (
                <button
                  type="button"
                  key={slot.minute}
                  onClick={() => useSlotInEditor(slot)}
                  className={`timeline-item ${isCurrent ? 'current-slot' : ''} ${isNext ? 'next-slot' : ''}`.trim()}
                >
                  <p className="timeline-time">{slot.timeText}</p>
                  <p className="timeline-activity">{slot.activity}</p>
                </button>
              )
            })}
          </div>
        </section>
      ) : null}

      {viewMode === 'widgets' ? (
        <section className="widgets-grid">
          <article className="card widget-card">
            <p className="label">Widget: Now</p>
            <p className="widget-big">{status.currentActivity}</p>
            <p className="meta">{status.currentTimeText}</p>
          </article>

          <article className="card widget-card">
            <p className="label">Widget: Up Next</p>
            <p className="widget-big">{status.nextActivity}</p>
            <p className="meta">Next 15-minute slot</p>
          </article>

          <article className="card widget-card">
            <p className="label">Widget: Day Progress</p>
            <p className="widget-big">{dayProgress}% Complete</p>
            <p className="meta">{dayRemainingMinutes} minutes left today</p>
          </article>

          <article className="card widget-card">
            <p className="label">Widget: Template</p>
            <p className="widget-big">{activeTemplate?.name || 'None'}</p>
            <p className="meta">Switch template from the chip row above</p>
          </article>
        </section>
      ) : null}

      {viewMode === 'templates' ? (
        <>
          <section className="card">
            <p className="label">Create New Template</p>
            <input
              className="input-control"
              value={newTemplateName}
              onChange={(event) => setNewTemplateName(event.target.value)}
              placeholder="Template name (optional)"
            />
            <button className="action-btn" onClick={createTemplateFromCurrent}>
              Create From Current Template
            </button>
          </section>

          <section className="card">
            <p className="label">Manage Templates</p>
            <div className="template-list">
              {templates.map((template) => (
                <div key={template.id} className="template-row">
                  <button
                    className={`template-row-main ${template.id === activeTemplate?.id ? 'template-row-main-active' : ''}`.trim()}
                    onClick={() => setActiveTemplateId(template.id)}
                  >
                    {template.name}
                  </button>
                  <button className="danger-btn" onClick={() => removeTemplate(template.id)}>
                    Remove
                  </button>
                </div>
              ))}
            </div>
          </section>

          <section className="card">
            <p className="label">Edit Timeblocks and Activities</p>
            <div className="day-picker-row">
              {DAYS.map((day) => (
                <button
                  key={day}
                  className={`day-pill ${day === editorDay ? 'day-pill-active' : ''}`.trim()}
                  onClick={() => setEditorDay(day)}
                >
                  {day.slice(0, 3)}
                </button>
              ))}
            </div>

            <div className="time-adjust-row">
              <button className="small-btn" onClick={() => setEditorMinute((prev) => (prev - 15 + 1440) % 1440)}>
                -15 min
              </button>
              <p className="editor-time">{minuteToLabel(editorMinute)}</p>
              <button className="small-btn" onClick={() => setEditorMinute((prev) => (prev + 15) % 1440)}>
                +15 min
              </button>
            </div>

            <p className="meta">Current value: {slotValue || 'Empty slot'}</p>

            <input
              className="input-control"
              value={editorActivity}
              onChange={(event) => setEditorActivity(event.target.value)}
              placeholder="Enter activity"
            />

            <div className="editor-actions-row">
              <button className="action-btn" onClick={saveEditedActivity}>
                Save Activity
              </button>
              <button className="ghost-btn" onClick={clearEditedActivity}>
                Clear Slot
              </button>
            </div>
          </section>
        </>
      ) : null}

      <section className="card">
        <p className="label">Notifications</p>
        <p className="meta">You will get sound and popup alerts when a new 15-minute block starts.</p>
        <button className="notify-btn" onClick={enableNotifications}>
          Enable Browser Pop-up Notifications
        </button>
      </section>

      <section className="card">
        <p className="label">Install As Browser App</p>
        <p className="meta">
          Install this web app to run in its own app window. If install button is unavailable, use browser menu.
        </p>
        <button className="action-btn install-btn" onClick={installAsBrowserApp}>
          {isStandalone ? 'Already Installed' : 'Install App'}
        </button>
      </section>

      {error ? (
        <section className="card error-card">
          <p className="label">Schedule Error</p>
          <p>{error}</p>
          <p className="meta">Ensure Schedule.csv exists in the public folder.</p>
        </section>
      ) : null}

      <section className="mode-bar">
        {VIEW_MODES.map((mode) => {
          const selected = mode === viewMode
          const labels = {
            current: 'Current',
            timeline: 'Timeline',
            widgets: 'Widgets',
            templates: 'Templates',
          }

          return (
            <button
              key={mode}
              className={`mode-btn ${selected ? 'mode-btn-active' : ''}`.trim()}
              onClick={() => setViewMode(mode)}
            >
              {labels[mode]}
            </button>
          )
        })}
      </section>

      {toast ? <section className="toast-popup">{toast}</section> : null}
      {!hydrated ? <section className="loading-mask">Loading templates...</section> : null}
    </main>
  )
}

export default App
