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

(defun mcp:execute (req res / outcome)
  (setq *mcp-thrown* nil)
  (setq outcome (vl-catch-all-apply 'mcp:eval-request (list req)))
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

(defun mcp:entity-summary (e / d)
  (setq d (entget e))
  (list (cdr (assoc 5 d)) (cdr (assoc 0 d)) (cdr (assoc 8 d))))

(defun mcp:summarize-set (ss limit / total i out)
  (setq total (if ss (sslength ss) 0))
  (setq i 0 out nil)
  (while (and (< i total) (< i limit))
    (setq out (cons (mcp:entity-summary (ssname ss i)) out))
    (setq i (1+ i)))
  (list total (reverse out)))

(defun mcp:list-entities (filter layer limit / conditions)
  (setq conditions nil)
  (if layer (setq conditions (cons (cons 8 layer) conditions)))
  (if filter (setq conditions (cons (cons 0 filter) conditions)))
  (mcp:summarize-set (if conditions (ssget "_X" conditions) (ssget "_X")) limit))

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

(setq mcp:api 2)

(princ)
