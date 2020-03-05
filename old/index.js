import { Object3D } from 'three'
import React, { useState, useEffect, useContext, useRef, useMemo } from 'react'
import { useFrame } from 'react-three-fiber'
import CannonWorker from 'web-worker:../src/worker.js'

const refs = {}
const buffers = React.createRef()
const bodies = React.createRef()
bodies.current = {}

const context = React.createContext()
export function Physics({ children, gravity = [0, -10, 0], tolerance = 0.001 }) {
  const [worker, setWorker] = useState()
  const [count, setCount] = useState(0)

  useEffect(() => {
    if (count) {
      let positions = new Float32Array(count * 3)
      let quaternions = new Float32Array(count * 4)

      // Initialize worker
      let currentWorker = new CannonWorker()
      currentWorker.postMessage({ op: 'init', gravity, tolerance })

      function loop() {
        if (positions.byteLength !== 0 && quaternions.byteLength !== 0) {
          currentWorker.postMessage({ op: 'step', positions, quaternions }, [positions.buffer, quaternions.buffer])
        }
      }

      currentWorker.onmessage = e => {
        switch (e.data.op) {
          case 'frame': {
            positions = e.data.positions
            quaternions = e.data.quaternions
            buffers.current = { positions, quaternions }
            requestAnimationFrame(loop)
            break
          }
          case 'sync': {
            bodies.current = e.data.bodies.reduce((acc, id) => ({ ...acc, [id]: e.data.bodies.indexOf(id) }), {})
            break
          }
          default:
            break
        }
      }
      loop()
      setWorker(currentWorker)
      return () => currentWorker.terminate()
    }
  }, [count])

  const api = useMemo(() => ({ worker, setCount }), [worker])
  return <context.Provider value={api} children={children} />
}

export function useCannon(props, deps = []) {
  const ref = useRef()
  const { worker, setCount } = useContext(context)

  useEffect(() => {
    const uuid = ref.current.uuid
    refs[uuid] = ref
    setCount(i => i + 1)
    return () => {
      setCount(i => i - 1)
      delete refs[uuid]
    }
  }, [setCount])

  useEffect(() => {
    const uuid = ref.current.uuid
    if (worker) {
      buffers.current = null
      bodies.current = {}
      worker.postMessage({ op: 'addBody', uuid, ...props })
      return () => worker.postMessage({ op: 'removeBody', uuid })
    }
  }, [worker, ...deps]) // eslint-disable-line react-hooks/exhaustive-deps

  useFrame(() => {
    if (buffers.current && buffers.current.positions.length) {
      const index = bodies.current[ref.current.uuid]
      if (index !== undefined) {
        ref.current.position.fromArray(buffers.current.positions, index * 3)
        ref.current.quaternion.fromArray(buffers.current.quaternions, index * 4)
      }
    }
  })

  const api = useMemo(
    () => ({
      setPosition(position) {
        if (worker) worker.postMessage({ op: 'setPosition', uuid: ref.current.uuid, position })
      },
    }),
    [worker]
  )
  return [ref, api]
}

const _object = new Object3D()
export function useCannonInstanced({ args, position, rotation, ...props }, deps = []) {
  const ref = useRef()
  const { worker, setCount } = useContext(context)

  useEffect(() => {
    const count = ref.current.count
    const uuid = ref.current.uuid
    refs[uuid] = ref
    setCount(i => i + count)
    return () => {
      setCount(i => i - count)
      delete refs[uuid]
    }
  }, [setCount])

  useEffect(() => {
    if (worker) {
      ref.current.instanceMatrix.setUsage(35048)
      buffers.current = null
      bodies.current = {}
      const uuid = new Array(ref.current.count).fill().map((_, i) => `${ref.current.uuid}_${i}`)
      if (typeof position === 'function') position = uuid.map((_, i) => position(i))
      if (typeof rotation === 'function') rotation = uuid.map((_, i) => rotation(i))
      if (typeof args === 'function') args = uuid.map((_, i) => args(i))

      worker.postMessage({
        op: 'addBodies',
        uuid,
        ...props,
        args,
        position,
        rotation,
      })
      return () => worker.postMessage({ op: 'removeBodies', uuid })
    }
  }, [worker, ...deps]) // eslint-disable-line react-hooks/exhaustive-deps

  useFrame(() => {
    if (buffers.current && buffers.current.positions.length) {
      for (let i = 0; i < ref.current.count; i++) {
        const index = bodies.current[`${ref.current.uuid}_${i}`]
        if (index !== undefined) {
          _object.position.fromArray(buffers.current.positions, index * 3)
          _object.quaternion.fromArray(buffers.current.quaternions, index * 4)
          _object.updateMatrix()
          ref.current.setMatrixAt(i, _object.matrix)
        }
      }
      ref.current.instanceMatrix.needsUpdate = true
    }
  })

  const api = useMemo(
    () => ({
      // fallback, but setPositionAt is probably more in line with the instancedmesh api
      setPosition(index, position) {
        api.setPositionAt(index, position)
      },
      setPositionAt(index, position) {
        if (worker) worker.postMessage({ op: 'setPosition', uuid: `${ref.current.uuid}_${index}`, position })
      },
    }),
    [worker]
  )
  return [ref, api]
}