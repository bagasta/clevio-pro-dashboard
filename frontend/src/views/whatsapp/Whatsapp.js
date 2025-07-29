import React, { useState, useEffect } from 'react'
import { CCard, CCardHeader, CCardBody, CFormInput, CButton } from '@coreui/react'
import axios from 'axios'
import { io } from 'socket.io-client'
import QRCode from 'qrcode'

const socket = io('http://localhost:3001')

const Whatsapp = () => {
  const [sessionName, setSessionName] = useState('')
  const [qrDataUrl, setQrDataUrl] = useState('')

  useEffect(() => {
    const handleQr = async ({ session, qr }) => {
      if (session === sessionName) {
        const url = await QRCode.toDataURL(qr)
        setQrDataUrl(url)
      }
    }

    const handleReady = ({ session }) => {
      if (session === sessionName) {
        setQrDataUrl('')
      }
    }

    socket.on('qr', handleQr)
    socket.on('ready', handleReady)

    return () => {
      socket.off('qr', handleQr)
      socket.off('ready', handleReady)
    }
  }, [sessionName])

  const startSession = async () => {
    if (!sessionName) return
    try {
      await axios.post(`/api/sessions/${sessionName}`)
    } catch (err) {
      console.error(err)
    }
  }

  return (
    <CCard>
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
        {qrDataUrl && (
          <div className="text-center">
            <img src={qrDataUrl} alt="QR Code" />
          </div>
        )}
      </CCardBody>
    </CCard>
  )
}

export default Whatsapp
