(vl-load-com)

(setq *mcp-thrown* nil)

(defun mcp:throw (msg)
  (setq *mcp-thrown* msg)
  (exit))

(defun mcp:join (parts sep / out)
  (setq out "")
  (foreach part parts
    (setq out (if (= out "") part (strcat out sep part))))
  out)

(defun mcp:hex4 (code / digits)
  (setq digits "0123456789abcdef")
  (strcat "\\u"
          (substr digits (1+ (rem (/ code 4096) 16)) 1)
          (substr digits (1+ (rem (/ code 256) 16)) 1)
          (substr digits (1+ (rem (/ code 16) 16)) 1)
          (substr digits (1+ (rem code 16)) 1)))

(defun mcp:json-escape (s / out i n c code)
  (setq out "" i 1 n (strlen s))
  (while (<= i n)
    (setq c (substr s i 1))
    (setq code (ascii c))
    (setq out
      (strcat out
        (cond
          ((= c "\"") "\\\"")
          ((= c "\\") "\\\\")
          ((= code 10) "\\n")
          ((= code 13) "\\r")
          ((= code 9) "\\t")
          ((or (< code 32) (> code 126)) (mcp:hex4 code))
          (T c))))
    (setq i (1+ i)))
  out)

(defun mcp:num->json (v / s)
  (if (eq (type v) 'INT)
      (itoa v)
      (progn
        (setq s (rtos v 2 8))
        (cond
          ((wcmatch s "`.*") (setq s (strcat "0" s)))
          ((wcmatch s "-`.*") (setq s (strcat "-0" (substr s 2)))))
        (cond
          ((wcmatch s "*`.") (strcat s "0"))
          ((not (wcmatch s "*`.*")) (strcat s ".0"))
          (T s)))))

(defun mcp:handle-of (e)
  (cdr (assoc 5 (entget e))))

(defun mcp:proper-list-p (v)
  (numberp (vl-list-length v)))

(defun mcp:to-json (v)
  (cond
    ((null v) "null")
    ((eq v T) "true")
    ((numberp v) (mcp:num->json v))
    ((eq (type v) 'STR) (strcat "\"" (mcp:json-escape v) "\""))
    ((eq (type v) 'ENAME) (strcat "\"" (mcp:json-escape (mcp:handle-of v)) "\""))
    ((and (listp v) (mcp:proper-list-p v))
     (strcat "[" (mcp:join (mapcar 'mcp:to-json v) ",") "]"))
    ((listp v)
     (strcat "[" (mcp:to-json (car v)) "," (mcp:to-json (cdr v)) "]"))
    (T (strcat "\"" (mcp:json-escape (vl-prin1-to-string v)) "\""))))

(defun mcp:read-file (path / f line out)
  (setq f (open path "r"))
  (if (null f) (mcp:throw (strcat "cannot open request file " path)))
  (setq out "")
  (while (setq line (read-line f))
    (setq out (strcat out line "\n")))
  (close f)
  out)

(defun mcp:write-file (path content / f)
  (setq f (open path "w"))
  (if f (progn (princ content f) (close f))))

(defun mcp:respond (path json / tmp)
  (setq tmp (strcat path ".tmp"))
  (mcp:write-file tmp json)
  (vl-file-rename tmp path))

(defun mcp:success-json (value)
  (strcat "{\"ok\":true,\"result\":" (mcp:to-json value) "}"))

(defun mcp:failure-json (msg)
  (strcat "{\"ok\":false,\"error\":\"" (mcp:json-escape msg) "\"}"))

(defun mcp:eval-request (req / text expr)
  (setq text (mcp:read-file req))
  (setq expr (vl-catch-all-apply 'read (list text)))
  (if (vl-catch-all-error-p expr)
      (mcp:throw (strcat "unreadable request: " (vl-catch-all-error-message expr))))
  (eval expr))

(defun mcp:execute (req res / outcome doc marked)
  (setq *mcp-thrown* nil)
  (setq doc (vl-catch-all-apply 'mcp:active-document nil))
  (setq marked
    (and (not (vl-catch-all-error-p doc))
         (not (vl-catch-all-error-p (vl-catch-all-apply 'vla-StartUndoMark (list doc))))))
  (setq outcome (vl-catch-all-apply 'mcp:eval-request (list req)))
  (if marked (vl-catch-all-apply 'vla-EndUndoMark (list doc)))
  (if (vl-catch-all-error-p outcome)
      (mcp:respond res
        (mcp:failure-json
          (if *mcp-thrown* *mcp-thrown* (vl-catch-all-error-message outcome))))
      (mcp:respond res (mcp:success-json outcome)))
  (princ))

(defun mcp:active-document ()
  (vla-get-ActiveDocument (vlax-get-acad-object)))

(defun mcp:require-entity (h / e)
  (setq e (handent h))
  (if (null e) (mcp:throw (strcat "no entity with handle " h)))
  e)

(defun mcp:made-entity (e)
  (if (null e) (mcp:throw "entity creation failed"))
  (mcp:handle-of e))

(defun mcp:require-layer (name)
  (if (null (tblsearch "LAYER" name))
      (mcp:throw (strcat "no layer named " name)))
  name)

(defun mcp:box-or-nil (e / outcome minpt maxpt)
  (setq outcome
    (vl-catch-all-apply 'vla-GetBoundingBox (list (vlax-ename->vla-object e) 'minpt 'maxpt)))
  (if (vl-catch-all-error-p outcome)
      nil
      (list (vlax-safearray->list minpt) (vlax-safearray->list maxpt))))

(defun mcp:entity-text (d / parts)
  (if (member (cdr (assoc 0 d)) '("TEXT" "MTEXT" "DIMENSION" "ATTDEF" "ATTRIB"))
      (progn
        (setq parts nil)
        (foreach g d (if (= (car g) 3) (setq parts (cons (cdr g) parts))))
        (apply 'strcat
               (append (reverse parts)
                       (list (cond ((cdr (assoc 1 d))) (""))))))
      nil))

(defun mcp:entity-row (e / d)
  (setq d (entget e))
  (list (cdr (assoc 5 d)) (cdr (assoc 0 d)) (cdr (assoc 8 d))
        (cdr (assoc 62 d)) (mcp:box-or-nil e) (mcp:entity-text d)))

(defun mcp:summarize-set (ss limit / total i out)
  (setq total (if ss (sslength ss) 0))
  (setq i 0 out nil)
  (while (and (< i total) (< i limit))
    (setq out (cons (mcp:entity-row (ssname ss i)) out))
    (setq i (1+ i)))
  (list total (reverse out)))

(defun mcp:window-match (box w / mn mx x0 y0 x1 y1 mode cx cy)
  (if (null box)
      nil
      (progn
        (setq mn (car box) mx (cadr box)
              x0 (car w) y0 (cadr w) x1 (caddr w) y1 (cadddr w) mode (nth 4 w))
        (cond
          ((= mode "inside")
           (and (>= (car mn) x0) (>= (cadr mn) y0) (<= (car mx) x1) (<= (cadr mx) y1)))
          ((= mode "center")
           (setq cx (/ (+ (car mn) (car mx)) 2.0) cy (/ (+ (cadr mn) (cadr mx)) 2.0))
           (and (>= cx x0) (<= cx x1) (>= cy y0) (<= cy y1)))
          (T (and (<= (car mn) x1) (>= (car mx) x0) (<= (cadr mn) y1) (>= (cadr mx) y0)))))))

(defun mcp:list-entities (filter layer limit window / conditions ss i total out row)
  (setq conditions nil)
  (if layer (setq conditions (cons (cons 8 layer) conditions)))
  (if filter (setq conditions (cons (cons 0 filter) conditions)))
  (setq ss (if conditions (ssget "_X" conditions) (ssget "_X")))
  (if (null window)
      (mcp:summarize-set ss limit)
      (progn
        (setq i 0 total 0 out nil)
        (while (and ss (< i (sslength ss)))
          (setq row (mcp:entity-row (ssname ss i)))
          (if (mcp:window-match (nth 4 row) window)
              (progn
                (setq total (1+ total))
                (if (<= total limit) (setq out (cons row out)))))
          (setq i (1+ i)))
        (list total (reverse out)))))

(defun mcp:count-into (alist key / pair)
  (setq pair (assoc key alist))
  (if pair
      (subst (cons key (1+ (cdr pair))) pair alist)
      (cons (cons key 1) alist)))

(defun mcp:drawing-overview (/ ss total i d tp byType byLayer byBlock blocks bd name ent bcount)
  (setq ss (ssget "_X") total (if ss (sslength ss) 0))
  (setq i 0 byType nil byLayer nil byBlock nil)
  (while (< i total)
    (setq d (entget (ssname ss i)) tp (cdr (assoc 0 d)))
    (setq byType (mcp:count-into byType tp))
    (setq byLayer (mcp:count-into byLayer (cdr (assoc 8 d))))
    (if (= tp "INSERT") (setq byBlock (mcp:count-into byBlock (cdr (assoc 2 d)))))
    (setq i (1+ i)))
  (setq blocks nil bd (tblnext "BLOCK" T))
  (while bd
    (setq name (cdr (assoc 2 bd)) ent (cdr (assoc -2 bd)) bcount 0)
    (if (or (not (wcmatch name "`**")) (assoc name byBlock))
        (progn
          (while ent (setq bcount (1+ bcount) ent (entnext ent)))
          (setq blocks (cons (list name bcount (cond ((cdr (assoc name byBlock))) (0))) blocks))))
    (setq bd (tblnext "BLOCK")))
  (list total (reverse byType) (reverse byLayer)
        (if (> total 0) (list (getvar "EXTMIN") (getvar "EXTMAX")) nil)
        (reverse blocks)))

(defun mcp:block-definition (name limit / d base ent total out)
  (setq d (tblsearch "BLOCK" name))
  (if (null d) (mcp:throw (strcat "no block named " name)))
  (setq base (cdr (assoc 10 d)) ent (cdr (assoc -2 d)))
  (setq total 0 out nil)
  (while ent
    (setq total (1+ total))
    (if (<= total limit) (setq out (cons (mcp:entity-row ent) out)))
    (setq ent (entnext ent)))
  (list base total (reverse out)))

(defun mcp:selected-entities (limit)
  (mcp:summarize-set (cadr (ssgetfirst)) limit))

(defun mcp:entity-box (h / outcome minpt maxpt)
  (setq outcome
    (vl-catch-all-apply 'vla-GetBoundingBox (list (mcp:vla-of h) 'minpt 'maxpt)))
  (if (vl-catch-all-error-p outcome)
      (mcp:throw (strcat "no bounding box for entity " h)))
  (list h (vlax-safearray->list minpt) (vlax-safearray->list maxpt)))

(defun mcp:bounding-boxes (handles)
  (mapcar 'mcp:entity-box handles))

(defun mcp:vla-of (h)
  (vlax-ename->vla-object (mcp:require-entity h)))

(defun mcp:point3d (p)
  (vlax-3d-point (car p) (cadr p) (caddr p)))

(defun mcp:erase (handles / n)
  (setq n 0)
  (foreach h handles
    (entdel (mcp:require-entity h))
    (setq n (1+ n)))
  n)

(defun mcp:move (handles delta / origin)
  (setq origin (vlax-3d-point 0 0 0))
  (foreach h handles
    (vla-Move (mcp:vla-of h) origin (mcp:point3d delta)))
  (length handles))

(defun mcp:dim-aligned (pa pb loc txt layer / before oldlayer oldos e)
  (if layer (mcp:require-layer layer))
  (setq before (entlast) oldlayer (getvar "CLAYER") oldos (getvar "OSMODE"))
  (setvar "OSMODE" 0)
  (if layer (setvar "CLAYER" layer))
  (if txt
      (command "_.DIMALIGNED" pa pb "_T" txt loc)
      (command "_.DIMALIGNED" pa pb loc))
  (setvar "CLAYER" oldlayer)
  (setvar "OSMODE" oldos)
  (setq e (entlast))
  (if (or (null e) (eq e before)) (mcp:throw "dimension creation failed"))
  (mcp:handle-of e))

(defun mcp:copy (handles delta / origin out new)
  (setq origin (vlax-3d-point 0 0 0) out nil)
  (foreach h handles
    (setq new (vla-Copy (mcp:vla-of h)))
    (vla-Move new origin (mcp:point3d delta))
    (setq out (cons (vla-get-Handle new) out)))
  (reverse out))

(defun mcp:zoom-window (p1 p2)
  (vla-ZoomWindow (vlax-get-acad-object) (mcp:point3d p1) (mcp:point3d p2))
  T)

(defun mcp:rotate (handles base angle)
  (foreach h handles
    (vla-Rotate (mcp:vla-of h) (mcp:point3d base) angle))
  (length handles))

(defun mcp:scale (handles base factor)
  (foreach h handles
    (vla-ScaleEntity (mcp:vla-of h) (mcp:point3d base) factor))
  (length handles))

(defun mcp:list-layers (/ d out)
  (setq d (tblnext "LAYER" T) out nil)
  (while d
    (setq out (cons (list (cdr (assoc 2 d)) (cdr (assoc 62 d)) (cdr (assoc 70 d))) out))
    (setq d (tblnext "LAYER")))
  (reverse out))

(defun mcp:create-layer (name color / lyr)
  (setq lyr (vla-Add (vla-get-Layers (mcp:active-document)) name))
  (if color (vla-put-Color lyr color))
  (vla-get-Name lyr))

(defun mcp:list-blocks (/ d out name)
  (setq d (tblnext "BLOCK" T) out nil)
  (while d
    (setq name (cdr (assoc 2 d)))
    (if (not (wcmatch name "`**")) (setq out (cons name out)))
    (setq d (tblnext "BLOCK")))
  (reverse out))

(defun mcp:insert-block (name pt scale rot / obj)
  (if (null (tblsearch "BLOCK" name))
      (mcp:throw (strcat "no block named " name)))
  (setq obj
    (vla-InsertBlock (vla-get-ModelSpace (mcp:active-document))
                     (mcp:point3d pt) name scale scale scale rot))
  (mcp:handle-of (vlax-vla-object->ename obj)))

(setq mcp:api 5)

(princ)
