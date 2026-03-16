import { get, post, put, del } from './api'

/**
 * List cameras.
 * Params: status? ('active'|'inactive'|'error'), camera_type?, limit?, skip?
 */
export const getAllCameras = (params = {}) => {
  const q = new URLSearchParams(params).toString()
  return get(`/api/cameras${q ? '?' + q : ''}`)
}

export const getCameraById = (cameraId) => get(`/api/cameras/${cameraId}`)

/**
 * Register a new camera.
 * @param {object} data - { camera_id, name, camera_type, location?, latitude?, longitude?, metadata? }
 * camera_type: 'phone' | 'laptop' | 'usb' | 'ip' | 'cctv'
 */
export const registerCamera = (data) => post('/api/cameras/register', data)

/**
 * Update camera metadata or status.
 * @param {object} updates - { name?, location?, status?, metadata? }
 * status: 'active' | 'inactive' | 'error'
 */
export const updateCamera = (cameraId, updates) => put(`/api/cameras/${cameraId}`, updates)

export const deleteCamera = (cameraId) => del(`/api/cameras/${cameraId}`)

// Convenience wrappers
export const deactivateCamera        = (id) => updateCamera(id, { status: 'inactive' })
export const updateCameraSensitivity = (id, sensitivity) => updateCamera(id, { metadata: { sensitivity } })
export const toggleAfterHours        = (id, enabled)     => updateCamera(id, { metadata: { afterHours: enabled } })
