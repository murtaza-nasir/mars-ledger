// Bottom sheet that rises from the dock; drag down or tap the scrim to close.
import {AnimatePresence, motion, useDragControls} from 'motion/react';
import type {ReactNode} from 'react';

export function Sheet({open, onClose, children, title, tall, aside}: {open: boolean; onClose: () => void; children: ReactNode; title?: string; tall?: boolean; aside?: ReactNode}) {
  const drag = useDragControls();
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="scrim"
            initial={{opacity: 0}} animate={{opacity: 1}} exit={{opacity: 0}}
            onClick={onClose}
            style={{position: 'fixed', inset: 0, background: 'rgba(10,4,2,.62)', backdropFilter: 'blur(3px)', zIndex: 40}}
          />
          <motion.section
            key="sheet"
            role="dialog" aria-label={title}
            initial={{y: '100%'}} animate={{y: 0}} exit={{y: '100%'}}
            transition={{type: 'spring', stiffness: 320, damping: 34}}
            drag="y" dragControls={drag} dragListener={false} dragConstraints={{top: 0, bottom: 0}} dragElastic={{top: 0, bottom: 0.6}}
            onDragEnd={(_, i) => { if (i.offset.y > 120 || i.velocity.y > 600) onClose(); }}
            style={{
              position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 41,
              maxHeight: tall ? '94svh' : '86svh', display: 'flex', flexDirection: 'column',
              background: 'linear-gradient(180deg, var(--dusk-2), var(--dusk-1) 60%)',
              borderRadius: 'var(--radius-l) var(--radius-l) 0 0', boxShadow: '0 -1px 0 var(--rim-strong), 0 -30px 60px rgba(0,0,0,.45)',
              paddingBottom: 'env(safe-area-inset-bottom)',
            }}
          >
            <div onPointerDown={(e) => drag.start(e)} style={{padding: '10px 0 4px', touchAction: 'none', cursor: 'grab'}}>
              <div style={{width: 44, height: 5, borderRadius: 3, background: 'var(--rim-strong)', margin: '0 auto'}} />
              {(title || aside) && (
                <div style={{display: 'flex', alignItems: 'center', gap: 12, margin: '12px 20px 0'}}>
                  {title && <h2 style={{margin: 0, flex: 1, fontSize: 22, fontWeight: 700, fontVariationSettings: "'wdth' 80"}}>{title}</h2>}
                  {aside && <div style={{marginLeft: 'auto'}}>{aside}</div>}
                </div>
              )}
            </div>
            <div style={{overflowY: 'auto', padding: '8px 20px 20px', flex: 1}}>{children}</div>
          </motion.section>
        </>
      )}
    </AnimatePresence>
  );
}
