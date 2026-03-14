import EmptyState from '../components/primitives/EmptyState'
import PanelCard from '../components/primitives/PanelCard'
import SectionHeader from '../components/primitives/SectionHeader'
import { formatTimestamp } from '../playtime-utils'
import { type StatsOverview, type UserSettings } from '../types'

type SettingsViewProps = {
  settings: UserSettings | null
  draft: UserSettings | null
  trackedOverview: StatsOverview | null
  isSaving: boolean
  saveMessage: string
  liveMilestonesEnabled: boolean
  onChange: (next: UserSettings) => void
  onSave: () => void
  onToggleLiveMilestones: (enabled: boolean) => void
  onCheckForUpdates: () => void
}

function SettingsView({
  settings,
  draft,
  trackedOverview,
  isSaving,
  saveMessage,
  liveMilestonesEnabled,
  onChange,
  onSave,
  onToggleLiveMilestones,
  onCheckForUpdates,
}: SettingsViewProps) {
  if (!draft) {
    return (
      <div className="view-shell">
        <PanelCard>
          <SectionHeader title="Settings" />
          <EmptyState title="Loading settings..." description="Reading local app preferences." />
        </PanelCard>
      </div>
    )
  }

  return (
    <div className="view-shell">
      <div className="panel-grid-two">
        <PanelCard>
          <SectionHeader
            eyebrow="Settings"
            title="App behavior"
            description="Preferences are stored locally in the tracking database and applied immediately after saving."
          />

          <div className="settings-stack">
            <label className="settings-field">
              <span className="label">Session file override</span>
              <input
                className="text-input"
                type="text"
                value={draft.sessionPathOverride ?? ''}
                onChange={(event) => onChange({ ...draft, sessionPathOverride: event.target.value })}
                placeholder="Leave blank to auto-detect session.sav"
              />
            </label>

            <label className="settings-field inline-toggle">
              <span>
                <strong>Start with Windows</strong>
                <span className="subtle">Uses the Tauri autostart plugin.</span>
              </span>
              <input
                type="checkbox"
                checked={draft.startWithWindows}
                onChange={(event) => onChange({ ...draft, startWithWindows: event.target.checked })}
              />
            </label>

            <label className="settings-field inline-toggle">
              <span>
                <strong>Minimize to tray</strong>
                <span className="subtle">Closing the main window hides it to the system tray instead of quitting.</span>
              </span>
              <input
                type="checkbox"
                checked={draft.minimizeToTray}
                onChange={(event) => onChange({ ...draft, minimizeToTray: event.target.checked })}
              />
            </label>

            <label className="settings-field inline-toggle">
              <span>
                <strong>Auto-check updates</strong>
                <span className="subtle">If disabled, update checks only run when you trigger them manually.</span>
              </span>
              <input
                type="checkbox"
                checked={draft.autoCheckUpdates}
                onChange={(event) => onChange({ ...draft, autoCheckUpdates: event.target.checked })}
              />
            </label>

            <label className="settings-field">
              <span className="label">Historical refresh interval</span>
              <input
                className="text-input small-input"
                type="number"
                min="15"
                max="900"
                value={draft.refreshIntervalSeconds}
                onChange={(event) =>
                  onChange({
                    ...draft,
                    refreshIntervalSeconds: Number(event.target.value) || settings?.refreshIntervalSeconds || 60,
                  })
                }
              />
            </label>

            <label className="settings-field inline-toggle">
              <span>
                <strong>Live milestone notifications</strong>
                <span className="subtle">Show local toasts and desktop notifications for live session starts and time milestones.</span>
              </span>
              <input
                type="checkbox"
                checked={liveMilestonesEnabled}
                onChange={(event) => onToggleLiveMilestones(event.target.checked)}
              />
            </label>

            <div className="inline-input-row">
              <button className="btn" type="button" onClick={onSave} disabled={isSaving}>
                {isSaving ? 'Saving...' : 'Save settings'}
              </button>
              <button className="btn btn-secondary" type="button" onClick={onCheckForUpdates}>
                Check for updates
              </button>
            </div>

            {saveMessage ? <p className="header-status">{saveMessage}</p> : null}
          </div>
        </PanelCard>

        <PanelCard>
          <SectionHeader
            title="Tracker Diagnostics"
            description="Use this panel to verify what the live tracker can currently see on disk and in the running process list."
          />
          <dl className="key-value-list">
            <div>
              <dt className="label">Detected session path</dt>
              <dd className="mono">{trackedOverview?.diagnostics.sessionPath || 'Unavailable'}</dd>
            </div>
            <div>
              <dt className="label">KovaaK running</dt>
              <dd>{trackedOverview?.diagnostics.isKovaakRunning ? 'Yes' : 'No'}</dd>
            </div>
            <div>
              <dt className="label">Matched process</dt>
              <dd>{trackedOverview?.diagnostics.matchedProcessName || 'None'}</dd>
            </div>
            <div>
              <dt className="label">Session file last modified</dt>
              <dd>{formatTimestamp(trackedOverview?.diagnostics.sessionFileModifiedAt)}</dd>
            </div>
            <div>
              <dt className="label">Last tracker error</dt>
              <dd>{trackedOverview?.diagnostics.lastError || 'No tracker error recorded'}</dd>
            </div>
          </dl>
        </PanelCard>
      </div>

      <PanelCard>
        <SectionHeader
          title="Current Preferences Snapshot"
          description="Stored values currently loaded from the local tracking database."
        />
        <dl className="key-value-list">
          <div>
            <dt className="label">Session override</dt>
            <dd className="mono">{settings?.sessionPathOverride || 'Auto-detect'}</dd>
          </div>
          <div>
            <dt className="label">Start with Windows</dt>
            <dd>{settings?.startWithWindows ? 'Enabled' : 'Disabled'}</dd>
          </div>
          <div>
            <dt className="label">Minimize to tray</dt>
            <dd>{settings?.minimizeToTray ? 'Enabled' : 'Disabled'}</dd>
          </div>
          <div>
            <dt className="label">Auto-check updates</dt>
            <dd>{settings?.autoCheckUpdates ? 'Enabled' : 'Disabled'}</dd>
          </div>
          <div>
            <dt className="label">Live milestones</dt>
            <dd>{liveMilestonesEnabled ? 'Enabled' : 'Disabled'}</dd>
          </div>
          <div>
            <dt className="label">Refresh interval</dt>
            <dd>{settings?.refreshIntervalSeconds ?? 60} seconds</dd>
          </div>
        </dl>
      </PanelCard>
    </div>
  )
}

export default SettingsView
