;; kantor-rpg: KRCOUNT menghitung entitas model space per layer dan tipe,
;; lalu menulis <nama>.autocad-counts.txt di folder gambar. Format baris:
;; "<LAYER> <TIPE> <JUMLAH>", sama dengan kunci di cad/out/<ID>.counts.json.
;; Bandingkan dengan: python3 cad/autocad/compare_counts.py cad/out/A-101.counts.json <file txt>
;; Status: BELUM DIUJI, AutoCAD tidak tersedia di container cloud.
(vl-load-com)
(defun c:KRCOUNT (/ ss i ed key pair lst fn f total)
  (setq ss (ssget "_X" '((410 . "Model"))) lst '() total 0)
  (if ss
    (progn
      (setq i 0 total (sslength ss))
      (repeat total
        (setq ed (entget (ssname ss i))
              key (strcat (cdr (assoc 8 ed)) " " (cdr (assoc 0 ed)))
              pair (assoc key lst))
        (if pair
          (setq lst (subst (cons key (1+ (cdr pair))) pair lst))
          (setq lst (cons (cons key 1) lst)))
        (setq i (1+ i)))))
  (setq lst (vl-sort lst '(lambda (a b) (< (car a) (car b)))))
  (setq fn (strcat (getvar "DWGPREFIX") (vl-filename-base (getvar "DWGNAME")) ".autocad-counts.txt"))
  (setq f (open fn "w"))
  (foreach p lst
    (write-line (strcat (car p) " " (itoa (cdr p))) f)
    (princ (strcat "\n" (car p) " " (itoa (cdr p)))))
  (write-line (strcat "TOTAL MODELSPACE " (itoa total)) f)
  (close f)
  (princ (strcat "\nTotal model space: " (itoa total) "\nDitulis ke: " fn))
  (princ))
(princ "\nkantor-rpg: ketik KRCOUNT untuk menghitung entitas per layer.")
(princ)
