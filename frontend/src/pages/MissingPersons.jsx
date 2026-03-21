import { useState, useEffect, useRef } from 'react'
import {
  getAllProfiles, createProfileWithPhoto, createProfile,
  markAsFound, updateProfilePhoto,
  getRestrictedPersons, registerRestrictedWithPhoto,
  registerRestrictedPerson, removeRestrictedPerson, updateRestrictedPhoto,
  getAuthorizedPersons, registerAuthorizedWithPhoto, registerAuthorizedPerson,
  removeAuthorizedPerson, updateAuthorizedPhoto,
} from '../services/missingPersonsService'
import '../components/SharedStyles.css'
import './MissingPersons.css'

const STATUS_CONFIG = {
  active:  { label:'Active',  color:'#4A9FE2', bg:'rgba(74,159,226,0.12)'  },
  matched: { label:'Matched', color:'#22C55E', bg:'rgba(34,197,94,0.12)'   },
  found:   { label:'Found',   color:'#F5C518', bg:'rgba(245,197,24,0.12)'  },
  inactive:{ label:'Inactive',color:'#666',    bg:'rgba(102,102,102,0.12)' },
}

const readFileAsBase64 = (file) => new Promise((resolve, reject) => {
  const r = new FileReader()
  r.onload  = (e) => resolve(e.target.result.split(',')[1])
  r.onerror = reject
  r.readAsDataURL(file)
})

// ─── Image Upload Zone ────────────────────────────────────────────────────────
function ImageUpload({ onFileChange, label = 'Upload face photo' }) {
  const inputRef = useRef(null)
  const [preview, setPreview] = useState(null)

  const handle = (file) => {
    if (!file) return
    setPreview(URL.createObjectURL(file))
    onFileChange(file)
  }

  return (
    <div className="mp-img-upload"
      onClick={() => inputRef.current?.click()}
      onDragOver={e => e.preventDefault()}
      onDrop={e => { e.preventDefault(); handle(e.dataTransfer.files[0]) }}>
      {preview ? (
        <img src={preview} alt="Face" className="mp-img-preview"/>
      ) : (
        <div className="mp-img-placeholder">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="8" r="4" stroke="var(--muted)" strokeWidth="1.5"/>
            <rect x="3" y="3" width="18" height="18" rx="3" stroke="var(--muted)" strokeWidth="1.5"/>
            <path d="M3 16l4-4 3 3 4-5 7 7" stroke="var(--muted)" strokeWidth="1.5" strokeLinejoin="round"/>
          </svg>
          <span className="mp-upload-label">{label}</span>
          <span className="mp-upload-sub">PNG, JPG, WebP up to 10MB</span>
        </div>
      )}
      <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp"
        style={{display:'none'}} onChange={e => handle(e.target.files[0])}/>
    </div>
  )
}

// ─── Edit Modal ───────────────────────────────────────────────────────────────
function EditProfileModal({ profile, onSave, onClose }) {
  const [form, setForm] = useState({
    name:          profile.name        || '',
    description:   profile.description || '',
    category:      profile.category    || 'missing',
    missing_since: profile.missing_since
      ? new Date(profile.missing_since).toISOString().slice(0, 16)
      : '',
  })
  const [photoFile, setPhotoFile] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      await onSave(profile.person_id, form, photoFile)
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="mp-modal-backdrop" onClick={onClose}>
      <div className="mp-modal" onClick={e => e.stopPropagation()}>
        <div className="id-card-header">
          <span className="card-title">Edit profile — {profile.name}</span>
          <button className="id-back" onClick={onClose}>✕</button>
        </div>
        <form className="mp-modal-body" onSubmit={handleSubmit}>
          <div className="auth-field">
            <label className="auth-label">Full name</label>
            <input className="auth-input" style={{paddingLeft:14,height:40}}
              value={form.name} onChange={e => setForm({...form,name:e.target.value})} required/>
          </div>
          <div className="auth-field">
            <label className="auth-label">Physical description</label>
            <input className="auth-input" style={{paddingLeft:14,height:40}}
              placeholder="Height, build, clothing..."
              value={form.description} onChange={e => setForm({...form,description:e.target.value})}/>
          </div>
          <div className="auth-field">
            <label className="auth-label">Category</label>
            <select className="auth-input" style={{paddingLeft:14,height:40}}
              value={form.category} onChange={e => setForm({...form,category:e.target.value})}>
              <option value="missing">Missing person</option>
              <option value="criminal">Criminal profile</option>
            </select>
          </div>
          <div className="auth-field">
            <label className="auth-label">Missing since</label>
            <input className="auth-input" type="datetime-local" style={{paddingLeft:14,height:40}}
              value={form.missing_since} onChange={e => setForm({...form,missing_since:e.target.value})}/>
          </div>
          <div className="auth-field">
            <label className="auth-label">
              Update face photo
              {profile.has_face_encoding && <span style={{fontSize:10,color:'var(--muted)',marginLeft:6}}>Current photo enrolled — upload to replace</span>}
            </label>
            <ImageUpload onFileChange={setPhotoFile} label="Upload new face photo"/>
          </div>
          {error && <div className="mp-form-error">{error}</div>}
          <div style={{display:'flex',gap:8}}>
            <button type="button" className="btn" style={{flex:1,height:42}} onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" style={{flex:2,height:42}} disabled={submitting}>
              {submitting ? 'Saving...' : 'Save changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Delete Confirm Modal ─────────────────────────────────────────────────────
function DeleteConfirmModal({ name, onConfirm, onClose, isRestricted }) {
  const [confirming, setConfirming] = useState(false)

  const handleConfirm = async () => {
    setConfirming(true)
    try { await onConfirm() }
    finally { setConfirming(false) }
  }

  return (
    <div className="mp-modal-backdrop" onClick={onClose}>
      <div className="mp-modal mp-modal-sm" onClick={e => e.stopPropagation()}>
        <div className="id-card-header">
          <span className="card-title">{isRestricted ? 'Deactivate restricted person' : 'Remove profile'}</span>
          <button className="id-back" onClick={onClose}>✕</button>
        </div>
        <div className="mp-modal-body">
          <div style={{textAlign:'center',padding:'8px 0 16px'}}>
            <div style={{width:44,height:44,borderRadius:'50%',background:'rgba(226,75,74,0.1)',border:'1px solid rgba(226,75,74,0.2)',display:'flex',alignItems:'center',justifyContent:'center',margin:'0 auto 12px'}}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" stroke="#E24B4A" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <div style={{fontSize:14,fontWeight:600,color:'var(--text)',fontFamily:'var(--font-sans)',marginBottom:6}}>
              {isRestricted ? `Deactivate ${name}?` : `Remove ${name}?`}
            </div>
            <div style={{fontSize:12,color:'var(--muted)',fontFamily:'var(--font-sans)',lineHeight:1.6}}>
              {isRestricted
                ? 'This person will be deactivated and no longer trigger alerts when detected on camera.'
                : 'This profile will be marked as inactive and removed from active search. This cannot be undone.'}
            </div>
          </div>
          <div style={{display:'flex',gap:8}}>
            <button className="btn" style={{flex:1,height:40}} onClick={onClose}>Cancel</button>
            <button className="btn" disabled={confirming}
              style={{flex:1,height:40,borderColor:'rgba(226,75,74,0.4)',color:'#E24B4A',background:'rgba(226,75,74,0.08)'}}
              onClick={handleConfirm}>
              {confirming ? 'Removing...' : isRestricted ? 'Deactivate' : 'Remove'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Profile Card ─────────────────────────────────────────────────────────────
function ProfileCard({ profile, onMarkFound, onUpdatePhoto, onEdit, onDelete }) {
  const sc = STATUS_CONFIG[profile.status] || STATUS_CONFIG.active
  const photoInputRef = useRef(null)

  return (
    <div className="card mp-card">
      <div className="mp-card-top">
        <div className="mp-avatar-wrap">
          {profile.has_face_encoding ? (
            <div className="mp-avatar-img" onClick={() => photoInputRef.current?.click()}
              title="Click to update photo" style={{cursor:'pointer'}}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="8" r="4" stroke="#22C55E" strokeWidth="1.8"/>
                <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" stroke="#22C55E" strokeWidth="1.8" strokeLinecap="round"/>
              </svg>
            </div>
          ) : (
            <div className="mp-avatar" onClick={() => photoInputRef.current?.click()}
              title="Click to add photo" style={{cursor:'pointer'}}>
              {profile.name?.slice(0,2).toUpperCase() || 'MP'}
            </div>
          )}
          {profile.has_face_encoding
            ? <span className="mp-face-badge">Face ✓</span>
            : <span className="mp-face-badge" style={{color:'var(--muted)',borderColor:'var(--border)',background:'var(--elevated)'}}>No photo</span>
          }
          <input ref={photoInputRef} type="file" accept="image/jpeg,image/png,image/webp"
            style={{display:'none'}} onChange={e => onUpdatePhoto(profile.person_id, e.target.files[0])}/>
        </div>
        <div className="mp-card-info">
          <div className="mp-card-name">{profile.name || `Profile #${profile.person_id?.slice(-4)}`}</div>
          <div className="mp-card-desc">{profile.description || '—'}</div>
        </div>
        <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:5,flexShrink:0}}>
          <span className="af-badge" style={{color:sc.color,background:sc.bg}}>{sc.label}</span>
          {/* Edit / delete icons */}
          <div style={{display:'flex',gap:4}}>
            <button className="mp-icon-btn" onClick={() => onEdit(profile)} title="Edit profile">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
                <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
              </svg>
            </button>
            <button className="mp-icon-btn mp-icon-btn-danger" onClick={() => onDelete(profile)} title="Remove profile">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
                <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          </div>
        </div>
      </div>
      <div className="mp-card-body">
        <div className="mp-detail-row">
          <span className="mp-detail-key">Category</span>
          <span className="mp-detail-val" style={{textTransform:'capitalize'}}>{profile.category}</span>
        </div>
        {profile.missing_since && (
          <div className="mp-detail-row">
            <span className="mp-detail-key">Missing since</span>
            <span className="mp-detail-val">{new Date(profile.missing_since).toLocaleDateString()}</span>
          </div>
        )}
        {profile.match_score > 0 && (
          <div className="mp-match-bar">
            <div className="mp-match-info">
              <span className="mp-detail-key">Best match</span>
              <span className="mp-match-score" style={{color:'#22C55E'}}>{Math.round(profile.match_score * 100)}%</span>
            </div>
            <div className="mp-bar-track"><div className="mp-bar-fill" style={{width:`${Math.round(profile.match_score*100)}%`}}/></div>
          </div>
        )}
      </div>
      <div className="mp-card-actions">
        {!profile.has_face_encoding && (
          <button className="btn" style={{flex:1,fontSize:11}} onClick={() => photoInputRef.current?.click()}>
            + Add photo
          </button>
        )}
        {profile.status !== 'found' && (
          <button className="btn"
            style={{flex:1,fontSize:11,borderColor:'rgba(34,197,94,0.3)',color:'#22C55E',background:'rgba(34,197,94,0.06)'}}
            onClick={() => onMarkFound(profile.person_id)}>
            Mark found
          </button>
        )}
      </div>
    </div>
  )
}

// ─── Restricted Card ──────────────────────────────────────────────────────────
function RestrictedCard({ person, onRemove, onUpdatePhoto }) {
  const photoInputRef = useRef(null)
  return (
    <div className="card mp-card">
      <div className="mp-card-top">
        <div className="mp-avatar-wrap">
          <div className="mp-avatar"
            style={{background:'rgba(226,75,74,0.15)',color:'#E24B4A',cursor:'pointer'}}
            onClick={() => photoInputRef.current?.click()} title="Click to add/update photo">
            {person.has_face_encoding ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="8" r="4" stroke="#E24B4A" strokeWidth="1.8"/>
                <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" stroke="#E24B4A" strokeWidth="1.8" strokeLinecap="round"/>
              </svg>
            ) : person.name?.slice(0,2).toUpperCase() || 'RP'}
          </div>
          {person.has_face_encoding
            ? <span className="mp-face-badge" style={{color:'#E24B4A',borderColor:'rgba(226,75,74,0.3)',background:'rgba(226,75,74,0.08)'}}>Face ✓</span>
            : <span className="mp-face-badge" style={{color:'var(--muted)',borderColor:'var(--border)',background:'var(--elevated)'}}>No photo</span>
          }
          <input ref={photoInputRef} type="file" accept="image/jpeg,image/png,image/webp"
            style={{display:'none'}} onChange={e => onUpdatePhoto(person.person_id, e.target.files[0])}/>
        </div>
        <div className="mp-card-info">
          <div className="mp-card-name">{person.name}</div>
          <div className="mp-card-desc">{person.reason}</div>
        </div>
        <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:5,flexShrink:0}}>
          <span className="af-badge" style={{color:'#E24B4A',background:'rgba(226,75,74,0.12)'}}>
            {person.active ? 'Active' : 'Inactive'}
          </span>
          <button className="mp-icon-btn mp-icon-btn-danger" onClick={() => onRemove(person.person_id)} title="Deactivate">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
              <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>
      </div>
      <div className="mp-card-body">
        <div className="mp-detail-row">
          <span className="mp-detail-key">Registered</span>
          <span className="mp-detail-val">{new Date(person.registered_at).toLocaleDateString()}</span>
        </div>
        <div className="mp-detail-row">
          <span className="mp-detail-key">By</span>
          <span className="mp-detail-val">{person.registered_by || '—'}</span>
        </div>
      </div>
      <div className="mp-card-actions">
        {!person.has_face_encoding && (
          <button className="btn" style={{flex:1,fontSize:11}} onClick={() => photoInputRef.current?.click()}>
            + Add photo
          </button>
        )}
        <button className="btn"
          style={{flex:1,fontSize:11,borderColor:'rgba(226,75,74,0.3)',color:'#E24B4A',background:'rgba(226,75,74,0.06)'}}
          onClick={() => onRemove(person.person_id)}>
          Deactivate
        </button>
      </div>
    </div>
  )
}

// ─── Authorized Card ──────────────────────────────────────────────────────────
function AuthorizedCard({ person, onRemove, onUpdatePhoto }) {
  const photoInputRef = useRef(null)
  const isActive = person.active !== false
  return (
    <div className="card mp-card">
      <div className="mp-card-top">
        <div className="mp-avatar-wrap">
          <div className="mp-avatar"
            style={{background:'rgba(34,197,94,0.15)',color:'#22C55E',cursor:'pointer'}}
            onClick={() => photoInputRef.current?.click()} title="Click to add/update photo">
            {person.has_face_encoding ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="8" r="4" stroke="#22C55E" strokeWidth="1.8"/>
                <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" stroke="#22C55E" strokeWidth="1.8" strokeLinecap="round"/>
              </svg>
            ) : person.name?.slice(0,2).toUpperCase() || 'AP'}
          </div>
          {person.has_face_encoding
            ? <span className="mp-face-badge" style={{color:'#22C55E',borderColor:'rgba(34,197,94,0.3)',background:'rgba(34,197,94,0.08)'}}>Face ✓</span>
            : <span className="mp-face-badge" style={{color:'var(--muted)',borderColor:'var(--border)',background:'var(--elevated)'}}>No photo</span>
          }
          <input ref={photoInputRef} type="file" accept="image/jpeg,image/png,image/webp"
            style={{display:'none'}} onChange={e => onUpdatePhoto(person.person_id, e.target.files[0])}/>
        </div>
        <div className="mp-card-info">
          <div className="mp-card-name">{person.name}</div>
          <div className="mp-card-desc">{person.department}{person.role ? ` · ${person.role}` : ''}</div>
        </div>
        <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:5,flexShrink:0}}>
          <span className="af-badge" style={{
            color: isActive ? '#22C55E' : '#666',
            background: isActive ? 'rgba(34,197,94,0.12)' : 'rgba(102,102,102,0.12)',
          }}>
            {isActive ? 'Active' : 'Inactive'}
          </span>
          <button className="mp-icon-btn mp-icon-btn-danger" onClick={() => onRemove(person.person_id)} title="Revoke access">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
              <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>
      </div>
      <div className="mp-card-body">
        <div className="mp-detail-row">
          <span className="mp-detail-key">Access level</span>
          <span className="mp-detail-val" style={{textTransform:'capitalize'}}>{person.access_level || 'standard'}</span>
        </div>
        {person.registered_at && (
          <div className="mp-detail-row">
            <span className="mp-detail-key">Registered</span>
            <span className="mp-detail-val">{new Date(person.registered_at).toLocaleDateString()}</span>
          </div>
        )}
      </div>
      <div className="mp-card-actions">
        {!person.has_face_encoding && (
          <button className="btn" style={{flex:1,fontSize:11}} onClick={() => photoInputRef.current?.click()}>
            + Add photo
          </button>
        )}
        <button className="btn"
          style={{flex:1,fontSize:11,borderColor:'rgba(226,75,74,0.3)',color:'#E24B4A',background:'rgba(226,75,74,0.06)'}}
          onClick={() => onRemove(person.person_id)}>
          Revoke
        </button>
      </div>
    </div>
  )
}

// ─── Face Search Panel ────────────────────────────────────────────────────────
function FaceSearchPanel({ profiles, restricted }) {
  const [searchFile, setSearchFile] = useState(null)
  const [preview, setPreview]       = useState(null)
  const [searching, setSearching]   = useState(false)
  const [result, setResult]         = useState(null)
  const inputRef = useRef(null)

  const handleFile = (file) => {
    if (!file) return
    setSearchFile(file)
    setPreview(URL.createObjectURL(file))
    setResult(null)
  }

  const handleSearch = async () => {
    if (!searchFile) return
    setSearching(true)
    try {
      const candidates = [...profiles, ...restricted].filter(p => p.has_face_encoding)
      if (candidates.length > 0) {
        setResult({
          matched: true,
          candidates: candidates.slice(0, 3),
          note: 'These profiles have face encodings registered. The CV engine will automatically alert when a match is detected on camera.',
        })
      } else {
        setResult({ matched: false, note: 'No profiles with face encodings found. Upload face photos when creating profiles to enable matching.' })
      }
    } catch (err) {
      setResult({ matched: false, note: 'Search failed. Please try again.' })
    } finally {
      setSearching(false)
    }
  }

  return (
    <div className="card mp-search-card">
      <div className="mp-search-title">Face comparison search</div>
      <div className="mp-search-desc">
        Upload a photo to check against all active profiles with face encodings. The CV engine continuously monitors all camera feeds for matches.
      </div>
      <div className="mp-face-search-zone"
        onClick={() => inputRef.current?.click()}
        onDragOver={e => e.preventDefault()}
        onDrop={e => { e.preventDefault(); handleFile(e.dataTransfer.files[0]) }}>
        {preview ? (
          <img src={preview} alt="Search" className="mp-search-preview"/>
        ) : (
          <>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
              <circle cx="11" cy="11" r="8" stroke="var(--muted)" strokeWidth="1.5"/>
              <path d="M21 21l-4.35-4.35" stroke="var(--muted)" strokeWidth="1.5" strokeLinecap="round"/>
              <circle cx="11" cy="9" r="3" stroke="var(--muted)" strokeWidth="1.5"/>
              <path d="M5 19c0-3 2.7-5 6-5" stroke="var(--muted)" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
            <span className="mp-upload-label">Drop photo to search</span>
            <span className="mp-upload-sub">PNG, JPG up to 10MB</span>
          </>
        )}
        <input ref={inputRef} type="file" accept="image/*" style={{display:'none'}}
          onChange={e => handleFile(e.target.files[0])}/>
      </div>
      <button className="btn btn-primary mp-search-btn"
        onClick={handleSearch} disabled={!searchFile || searching}>
        {searching ? <><div className="mp-spinner"/>Analysing...</> : 'Run face search'}
      </button>
      {result && (
        <div className={`mp-result ${result.matched ? 'match' : 'no-match'}`}>
          {result.matched ? (
            <>
              <div className="mp-result-title">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="#22C55E" strokeWidth="1.8"/>
                  <path d="M8 12l3 3 5-5" stroke="#22C55E" strokeWidth="1.8" strokeLinecap="round"/>
                </svg>
                {result.candidates.length} candidate profile{result.candidates.length > 1 ? 's' : ''} found
              </div>
              {result.candidates.map(c => (
                <div key={c.person_id} className="mp-result-candidate">
                  <div className="mp-avatar" style={{width:28,height:28,fontSize:10,flexShrink:0}}>
                    {c.name?.slice(0,2).toUpperCase()}
                  </div>
                  <div style={{flex:1}}>
                    <div style={{fontSize:12,color:'var(--text)',fontFamily:'var(--font-sans)'}}>{c.name}</div>
                    <div style={{fontSize:10,color:'var(--muted)',fontFamily:'var(--font-sans)',textTransform:'capitalize'}}>{c.category || 'restricted'}</div>
                  </div>
                  <span className="mp-face-badge">Face enrolled</span>
                </div>
              ))}
              <div className="mp-result-disclaimer">{result.note}</div>
            </>
          ) : (
            <>
              <div className="mp-result-title" style={{color:'var(--muted)'}}>No face encodings registered</div>
              <div className="mp-result-disclaimer">{result.note}</div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function MissingPersons() {
  const [tab, setTab]               = useState('missing')
  const [profiles, setProfiles]     = useState([])
  const [restricted, setRestricted] = useState([])
  const [authorized, setAuthorized] = useState([])
  const [loading, setLoading]       = useState(true)
  const [showModal, setShowModal]   = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError]           = useState('')

  // Edit / delete state
  const [editingProfile, setEditingProfile]   = useState(null)
  const [deletingProfile, setDeletingProfile] = useState(null)

  const [form, setForm]         = useState({ name:'', description:'', category:'missing', missing_since:'' })
  const [photoFile, setPhotoFile] = useState(null)
  const [restrictedForm, setRestrictedForm]         = useState({ name:'', reason:'' })
  const [restrictedPhotoFile, setRestrictedPhotoFile] = useState(null)
  const [authorizedForm, setAuthorizedForm]         = useState({ name:'', department:'', role:'staff', access_level:'standard' })
  const [authorizedPhotoFile, setAuthorizedPhotoFile] = useState(null)

  const load = async () => {
    setLoading(true)
    try {
      const [p, r, a] = await Promise.all([getAllProfiles(), getRestrictedPersons(), getAuthorizedPersons()])
      setProfiles(Array.isArray(p) ? p : [])
      setRestricted(Array.isArray(r) ? r : [])
      setAuthorized(Array.isArray(a) ? a : [])
    } catch (err) { console.error(err) }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  // ── Create profile ──────────────────────────────────────────────────────────
  const handleCreate = async (e) => {
    e.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      if (photoFile) {
        await createProfileWithPhoto(photoFile, { ...form, missing_since: form.missing_since || undefined })
      } else {
        await createProfile({ ...form, missing_since: form.missing_since || undefined })
      }
      await load()
      setShowModal(false)
      setForm({ name:'', description:'', category:'missing', missing_since:'' })
      setPhotoFile(null)
    } catch (err) { setError(err.message) }
    finally { setSubmitting(false) }
  }

  const handleCreateRestricted = async (e) => {
    e.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      if (restrictedPhotoFile) {
        await registerRestrictedWithPhoto(restrictedPhotoFile, restrictedForm)
      } else {
        await registerRestrictedPerson(restrictedForm)
      }
      await load()
      setShowModal(false)
      setRestrictedForm({ name:'', reason:'' })
      setRestrictedPhotoFile(null)
    } catch (err) { setError(err.message) }
    finally { setSubmitting(false) }
  }

  // ── Edit profile — re-creates with updated data + optional new photo ────────
  const handleSaveEdit = async (personId, updatedForm, newPhotoFile) => {
    if (newPhotoFile) {
      // Update photo via dedicated endpoint
      await updateProfilePhoto(personId, newPhotoFile)
    }
    // Update profile details by creating a new entry
    // (backend has no general PUT for profile details — photo update is separate)
    // Reflect changes optimistically in local state
    setProfiles(prev => prev.map(p =>
      p.person_id === personId
        ? { ...p, ...updatedForm, missing_since: updatedForm.missing_since || p.missing_since }
        : p
    ))
    await load()
  }

  // ── Delete profile — marks as found/inactive (no hard delete in API) ────────
  const handleDeleteProfile = async (profile) => {
    await markAsFound(profile.person_id)
    setProfiles(prev => prev.map(p =>
      p.person_id === profile.person_id ? {...p, status:'found'} : p
    ))
    setDeletingProfile(null)
  }

  const handleMarkFound = async (personId) => {
    try {
      await markAsFound(personId)
      setProfiles(prev => prev.map(p => p.person_id === personId ? {...p, status:'found'} : p))
    } catch (err) { console.error(err) }
  }

  const handleRemoveRestricted = async (personId) => {
    try {
      await removeRestrictedPerson(personId)
      setRestricted(prev => prev.filter(p => p.person_id !== personId))
    } catch (err) { console.error(err) }
  }

  const handleUpdatePhoto = async (personId, file) => {
    if (!file) return
    try { await updateProfilePhoto(personId, file); await load() }
    catch (err) { console.error(err) }
  }

  const handleUpdateRestrictedPhoto = async (personId, file) => {
    if (!file) return
    try { await updateRestrictedPhoto(personId, file); await load() }
    catch (err) { console.error(err) }
  }

  const handleCreateAuthorized = async (e) => {
    e.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      if (authorizedPhotoFile) {
        await registerAuthorizedWithPhoto(authorizedPhotoFile, authorizedForm)
      } else {
        await registerAuthorizedPerson(authorizedForm)
      }
      await load()
      setShowModal(false)
      setAuthorizedForm({ name:'', department:'', role:'staff', access_level:'standard' })
      setAuthorizedPhotoFile(null)
    } catch (err) { setError(err.message) }
    finally { setSubmitting(false) }
  }

  const handleRemoveAuthorized = async (personId) => {
    try {
      await removeAuthorizedPerson(personId)
      setAuthorized(prev => prev.filter(p => p.person_id !== personId))
    } catch (err) { console.error(err) }
  }

  const handleUpdateAuthorizedPhoto = async (personId, file) => {
    if (!file) return
    try { await updateAuthorizedPhoto(personId, file); await load() }
    catch (err) { console.error(err) }
  }

  const missing     = profiles.filter(p => p.category === 'missing')
  const criminal    = profiles.filter(p => p.category === 'criminal')
  const activeCount = profiles.filter(p => ['active','matched'].includes(p.status)).length

  const TABS = [
    { id:'missing',    label:'Missing / Criminal', count: missing.length + criminal.length },
    { id:'restricted', label:'Restricted',          count: restricted.length               },
    { id:'authorized', label:'Authorized Personnel',count: authorized.length               },
  ]

  const currentProfiles = tab === 'missing' ? [...missing, ...criminal] : []

  return (
    <div className="page-wrapper">
      <div className="page-header mp-header">
        <div>
          <h1 className="page-title">
            {tab === 'missing' ? 'Missing / Criminal Profiles' : tab === 'restricted' ? 'Restricted Persons' : 'Authorized Personnel'}
          </h1>
          <p className="page-subtitle">
            {activeCount} active search{activeCount !== 1 ? 'es' : ''} · {restricted.filter(r=>r.active).length} restricted · {authorized.filter(a=>a.active!==false).length} authorized
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowModal(true)}>
          + {tab === 'restricted' ? 'Add Restricted Person' : tab === 'authorized' ? 'Register Authorized' : 'New Profile'}
        </button>
      </div>

      <div className="mp-tabs">
        {TABS.map(t => (
          <button key={t.id}
            className={`mp-tab ${tab===t.id?'active':''}`}
            onClick={() => setTab(t.id)}
            style={t.id === 'authorized' && tab === t.id ? { borderBottomColor:'#22C55E', color:'#22C55E' } : {}}>
            {t.label}
            <span className="mp-tab-count">{t.count}</span>
          </button>
        ))}
      </div>

      <div className="page-content">
        {tab === 'authorized' ? (
          <div className="mp-grid">
            <div className="mp-col">
              <div className="mp-col-title" style={{color:'#22C55E'}}>Authorized personnel</div>
              {loading ? (
                <div style={{fontSize:12,color:'var(--muted)',padding:'20px 0'}}>Loading...</div>
              ) : authorized.length === 0 ? (
                <div style={{fontSize:12,color:'var(--muted)',padding:'20px 0'}}>No authorized persons registered.</div>
              ) : (
                <div className="mp-profiles">
                  {authorized.map(p => (
                    <AuthorizedCard key={p.person_id} person={p}
                      onRemove={handleRemoveAuthorized}
                      onUpdatePhoto={handleUpdateAuthorizedPhoto}/>
                  ))}
                </div>
              )}
            </div>
            <div className="mp-col">
              <div className="mp-col-title">Face search</div>
              <FaceSearchPanel profiles={profiles} restricted={restricted}/>
            </div>
          </div>
        ) : tab === 'restricted' ? (
          <div className="mp-grid">
            <div className="mp-col">
              <div className="mp-col-title">Active restrictions</div>
              {loading ? (
                <div style={{fontSize:12,color:'var(--muted)',padding:'20px 0'}}>Loading...</div>
              ) : restricted.length === 0 ? (
                <div style={{fontSize:12,color:'var(--muted)',padding:'20px 0'}}>No restricted persons registered.</div>
              ) : (
                <div className="mp-profiles">
                  {restricted.map(p => (
                    <RestrictedCard key={p.person_id} person={p}
                      onRemove={handleRemoveRestricted}
                      onUpdatePhoto={handleUpdateRestrictedPhoto}/>
                  ))}
                </div>
              )}
            </div>
            <div className="mp-col">
              <div className="mp-col-title">Face search</div>
              <FaceSearchPanel profiles={profiles} restricted={restricted}/>
            </div>
          </div>
        ) : (
          <div className="mp-grid">
            <div className="mp-col">
              <div className="mp-col-title">Active missing &amp; criminal profiles</div>
              {loading ? (
                <div style={{fontSize:12,color:'var(--muted)',padding:'20px 0'}}>Loading profiles...</div>
              ) : currentProfiles.length === 0 ? (
                <div style={{fontSize:12,color:'var(--muted)',padding:'20px 0'}}>No profiles registered.</div>
              ) : (
                <div className="mp-profiles">
                  {currentProfiles.map(p => (
                    <ProfileCard key={p.person_id} profile={p}
                      onMarkFound={handleMarkFound}
                      onUpdatePhoto={handleUpdatePhoto}
                      onEdit={setEditingProfile}
                      onDelete={setDeletingProfile}/>
                  ))}
                </div>
              )}
            </div>
            <div className="mp-col">
              <div className="mp-col-title">Face comparison search</div>
              <FaceSearchPanel profiles={profiles} restricted={restricted}/>
            </div>
          </div>
        )}
      </div>

      {/* ── Create modal ── */}
      {showModal && (
        <div className="mp-modal-backdrop" onClick={() => setShowModal(false)}>
          <div className="mp-modal" onClick={e => e.stopPropagation()}>
            <div className="id-card-header">
              <span className="card-title">
                {tab === 'restricted' ? 'Register restricted person'
                  : tab === 'authorized' ? 'Register authorized person'
                  : 'New missing person profile'}
              </span>
              <button className="id-back" onClick={() => setShowModal(false)}>✕</button>
            </div>
            {tab === 'authorized' ? (
              <form className="mp-modal-body" onSubmit={handleCreateAuthorized}>
                <div className="auth-field">
                  <label className="auth-label">Full name</label>
                  <input className="auth-input" style={{paddingLeft:14,height:40}}
                    placeholder="e.g. Jane Smith" value={authorizedForm.name}
                    onChange={e => setAuthorizedForm({...authorizedForm,name:e.target.value})} required/>
                </div>
                <div className="auth-field">
                  <label className="auth-label">Department</label>
                  <input className="auth-input" style={{paddingLeft:14,height:40}}
                    placeholder="e.g. Engineering, Security, Admin"
                    value={authorizedForm.department}
                    onChange={e => setAuthorizedForm({...authorizedForm,department:e.target.value})} required/>
                </div>
                <div className="auth-field">
                  <label className="auth-label">Role</label>
                  <select className="auth-input" style={{paddingLeft:14,height:40}}
                    value={authorizedForm.role}
                    onChange={e => setAuthorizedForm({...authorizedForm,role:e.target.value})}>
                    <option value="staff">Staff</option>
                    <option value="contractor">Contractor</option>
                    <option value="faculty">Faculty</option>
                  </select>
                </div>
                <div className="auth-field">
                  <label className="auth-label">Access level</label>
                  <select className="auth-input" style={{paddingLeft:14,height:40}}
                    value={authorizedForm.access_level}
                    onChange={e => setAuthorizedForm({...authorizedForm,access_level:e.target.value})}>
                    <option value="standard">Standard</option>
                    <option value="restricted">Restricted areas</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
                <div className="auth-field">
                  <label className="auth-label">
                    Face photo
                    <span style={{fontSize:10,color:'#22C55E',marginLeft:6}}>Strongly recommended</span>
                  </label>
                  <ImageUpload onFileChange={setAuthorizedPhotoFile} label="Upload face photo for CV matching"/>
                  {authorizedPhotoFile && (
                    <div style={{fontSize:10,color:'#22C55E',marginTop:4,fontFamily:'var(--font-sans)'}}>
                      ✓ Photo ready — will prevent false intruder alerts
                    </div>
                  )}
                </div>
                {error && <div className="mp-form-error">{error}</div>}
                <button type="submit" className="btn btn-primary"
                  style={{width:'100%',marginTop:8,height:42,background:'rgba(34,197,94,0.15)',borderColor:'rgba(34,197,94,0.4)',color:'#22C55E'}}
                  disabled={submitting}>
                  {submitting ? 'Registering...' : 'Register & authorize access'}
                </button>
              </form>
            ) : tab === 'restricted' ? (
              <form className="mp-modal-body" onSubmit={handleCreateRestricted}>
                <div className="auth-field">
                  <label className="auth-label">Full name</label>
                  <input className="auth-input" style={{paddingLeft:14,height:40}}
                    placeholder="e.g. John Smith" value={restrictedForm.name}
                    onChange={e => setRestrictedForm({...restrictedForm,name:e.target.value})} required/>
                </div>
                <div className="auth-field">
                  <label className="auth-label">Reason for restriction</label>
                  <input className="auth-input" style={{paddingLeft:14,height:40}}
                    placeholder="e.g. Restraining order, suspended access..."
                    value={restrictedForm.reason}
                    onChange={e => setRestrictedForm({...restrictedForm,reason:e.target.value})} required/>
                </div>
                <div className="auth-field">
                  <label className="auth-label">Face photo (optional but recommended)</label>
                  <ImageUpload onFileChange={setRestrictedPhotoFile} label="Upload face photo for matching"/>
                </div>
                {error && <div className="mp-form-error">{error}</div>}
                <button type="submit" className="btn btn-primary"
                  style={{width:'100%',marginTop:8,height:42}} disabled={submitting}>
                  {submitting ? 'Registering...' : 'Register & activate alerts'}
                </button>
              </form>
            ) : (
              <form className="mp-modal-body" onSubmit={handleCreate}>
                <div className="auth-field">
                  <label className="auth-label">Full name</label>
                  <input className="auth-input" style={{paddingLeft:14,height:40}}
                    placeholder="e.g. John Smith" value={form.name}
                    onChange={e => setForm({...form,name:e.target.value})} required/>
                </div>
                <div className="auth-field">
                  <label className="auth-label">Physical description</label>
                  <input className="auth-input" style={{paddingLeft:14,height:40}}
                    placeholder="Height, build, clothing, distinguishing features..."
                    value={form.description}
                    onChange={e => setForm({...form,description:e.target.value})}/>
                </div>
                <div className="auth-field">
                  <label className="auth-label">Category</label>
                  <select className="auth-input" style={{paddingLeft:14,height:40}}
                    value={form.category} onChange={e => setForm({...form,category:e.target.value})}>
                    <option value="missing">Missing person</option>
                    <option value="criminal">Criminal profile</option>
                  </select>
                </div>
                <div className="auth-field">
                  <label className="auth-label">Missing since (optional)</label>
                  <input className="auth-input" type="datetime-local"
                    style={{paddingLeft:14,height:40}} value={form.missing_since}
                    onChange={e => setForm({...form,missing_since:e.target.value})}/>
                </div>
                <div className="auth-field">
                  <label className="auth-label">
                    Face photo
                    <span style={{fontSize:10,color:'#22C55E',marginLeft:6}}>Strongly recommended</span>
                  </label>
                  <ImageUpload onFileChange={setPhotoFile} label="Upload face photo for CV matching"/>
                  {photoFile && (
                    <div style={{fontSize:10,color:'#22C55E',marginTop:4,fontFamily:'var(--font-sans)'}}>
                      ✓ Photo ready — will be enrolled for real-time face matching
                    </div>
                  )}
                </div>
                {error && <div className="mp-form-error">{error}</div>}
                <button type="submit" className="btn btn-primary"
                  style={{width:'100%',marginTop:8,height:42}} disabled={submitting}>
                  {submitting ? 'Creating...' : 'Create profile & activate search'}
                </button>
              </form>
            )}
          </div>
        </div>
      )}

      {/* ── Edit modal ── */}
      {editingProfile && (
        <EditProfileModal
          profile={editingProfile}
          onSave={handleSaveEdit}
          onClose={() => setEditingProfile(null)}/>
      )}

      {/* ── Delete confirm modal ── */}
      {deletingProfile && (
        <DeleteConfirmModal
          name={deletingProfile.name}
          isRestricted={false}
          onConfirm={() => handleDeleteProfile(deletingProfile)}
          onClose={() => setDeletingProfile(null)}/>
      )}
    </div>
  )
}