import React, { useState, useEffect } from 'react'
import {
  CCard,
  CCardHeader,
  CCardBody,
  CFormInput,
  CButton,
} from '@coreui/react'
import axios from 'axios'
import { io } from 'socket.io-client'
import QRCode from 'qrcode'

const socket = io('http://localhost:3001')

const Whatsapp = () => {
  const [sessionName, setSessionName] = useState('')
  const [sessions, setSessions] = useState({})

  const saveWebhook = async (name) => {
    const url = sessions[name].webhookInput
    if (!url) return
    try {
      await axios.post(`http://localhost:3001/api/sessions/${name}/webhook`, { url })
      setSessions((prev) => ({
        ...prev,
        [name]: { ...prev[name], webhook: url },
      }))
    } catch (err) {
      console.error(err)
    }
  }

  useEffect(() => {
    const handleQr = async ({ session, qr }) => {
      const url = await QRCode.toDataURL(qr)
      setSessions((prev) => ({
        ...prev,
        [session]: { ...prev[session], qrDataUrl: url, status: 'scan' },
      }))
    }

    const handleReady = ({ session }) => {
      setSessions((prev) => ({
        ...prev,
        [session]: { ...prev[session], qrDataUrl: '', status: 'ready' },
      }))
    }

    socket.on('qr', handleQr)
    socket.on('ready', handleReady)

    return () => {
      socket.off('qr', handleQr)
      socket.off('ready', handleReady)
    }
  }, [])

  const startSession = async () => {
    if (!sessionName) return
    try {
      await axios.post(`http://localhost:3001/api/sessions/${sessionName}`)
      setSessions((prev) => ({
        ...prev,
        [sessionName]: { status: 'initializing', qrDataUrl: '' },
      }))
      setSessionName('')
    } catch (err) {
      console.error(err)
    }
  }

  return (
    <div>
      <CCard className="mb-4">
        <CCardHeader>Create WhatsApp Session</CCardHeader>
        <CCardBody>
          <div className="mb-3 d-flex">
            <CFormInput
              placeholder="Session name"
              value={sessionName}
              onChange={(e) => setSessionName(e.target.value)}
              className="me-2"
            />
            <CButton onClick={startSession}>Create</CButton>
          </div>
        </CCardBody>
      </CCard>
      {Object.entries(sessions).map(([name, data]) => (
        <CCard key={name} className="mb-3">
          <CCardHeader>{name}</CCardHeader>
          <CCardBody className="text-center">
            {data.qrDataUrl ? (
              <img src={data.qrDataUrl} alt="QR Code" />
            ) : (
              <span>{data.status}</span>
            )}
            {data.status === 'ready' && (
              <div className="mt-3 d-flex">
                <CFormInput
                  placeholder="Webhook URL"
                  value={data.webhookInput || ''}
                  onChange={(e) =>
                    setSessions((prev) => ({
                      ...prev,
                      [name]: { ...prev[name], webhookInput: e.target.value },
                    }))
                  }
                  className="me-2"
                />
                <CButton onClick={() => saveWebhook(name)}>Save</CButton>
              </div>
            )}
          </CCardBody>
        </CCard>
      ))}
    </div>
  )
}

export default Whatsapp
