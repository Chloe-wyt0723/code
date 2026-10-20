import base64
import sys

import cv2
import numpy as np


def order_corners(points):
    points = np.asarray(points, dtype=np.float32)
    sums = points.sum(axis=1)
    diffs = np.diff(points, axis=1).reshape(-1)
    return np.array([
        points[np.argmin(sums)],
        points[np.argmin(diffs)],
        points[np.argmax(sums)],
        points[np.argmax(diffs)],
    ], dtype=np.float32)


def find_screen(image):
    height, width = image.shape[:2]
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(blurred, 35, 110)
    edges = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8), iterations=2)
    contours, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)

    image_area = float(width * height)
    candidates = []
    for contour in contours:
        perimeter = cv2.arcLength(contour, True)
        if perimeter <= 0:
            continue
        polygon = cv2.approxPolyDP(contour, 0.025 * perimeter, True)
        if len(polygon) != 4 or not cv2.isContourConvex(polygon):
            continue
        area = abs(cv2.contourArea(polygon))
        area_ratio = area / image_area
        if area_ratio < 0.015 or area_ratio > 0.78:
            continue
        corners = order_corners(polygon.reshape(4, 2))
        top = np.linalg.norm(corners[1] - corners[0])
        bottom = np.linalg.norm(corners[2] - corners[3])
        left = np.linalg.norm(corners[3] - corners[0])
        right = np.linalg.norm(corners[2] - corners[1])
        rect_width = (top + bottom) / 2
        rect_height = (left + right) / 2
        if rect_height <= 1:
            continue
        aspect = rect_width / rect_height
        if aspect < 0.75 or aspect > 2.8:
            continue
        # Prefer a large, landscape LCD-like rectangle, while down-weighting
        # very wide contours that are more likely to be the whole device bezel.
        aspect_score = max(0.0, 1.0 - abs(aspect - 1.55) / 1.55)
        score = area_ratio ** 0.65 * (0.55 + 0.45 * aspect_score)
        candidates.append((score, corners, rect_width, rect_height))

    if not candidates:
        return image

    _, corners, rect_width, rect_height = max(candidates, key=lambda candidate: candidate[0])
    out_width = max(1, int(round(rect_width)))
    out_height = max(1, int(round(rect_height)))
    target = np.array([
        [0, 0],
        [out_width - 1, 0],
        [out_width - 1, out_height - 1],
        [0, out_height - 1],
    ], dtype=np.float32)
    transform = cv2.getPerspectiveTransform(corners, target)
    return cv2.warpPerspective(image, transform, (out_width, out_height), flags=cv2.INTER_CUBIC)


def main():
    encoded = sys.stdin.buffer.read().strip()
    raw = base64.b64decode(encoded, validate=True)
    image = cv2.imdecode(np.frombuffer(raw, dtype=np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError('Unable to decode input image')

    screen = find_screen(image)
    gray = cv2.cvtColor(screen, cv2.COLOR_BGR2GRAY)
    gray = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(gray)
    binary = cv2.adaptiveThreshold(
        gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 31, 8
    )

    # Enlarge small screen crops so the LCD digits have enough pixels for OCR.
    height, width = binary.shape[:2]
    scale = min(3.0, 1200.0 / max(height, width))
    if scale > 1.0:
        binary = cv2.resize(binary, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)

    ok, output = cv2.imencode('.png', binary, [cv2.IMWRITE_PNG_COMPRESSION, 3])
    if not ok:
        raise ValueError('Unable to encode preprocessed image')
    sys.stdout.write(base64.b64encode(output.tobytes()).decode('ascii'))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
