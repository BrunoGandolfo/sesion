import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          fontSize: 124,
          background: "#4F7A6A",
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#FFFFFF",
          fontFamily: "Georgia, serif",
          fontWeight: 700,
          lineHeight: 1,
        }}
      >
        S
      </div>
    ),
    { ...size },
  );
}
