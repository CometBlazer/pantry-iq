import { createCn } from "cn/config"

// Teach the class merger about the DESIGN.md type scale, so `text-heading-md text-ink`
// is read as font-size + color instead of two conflicting colors.
export const cn = createCn({
  extend: {
    classGroups: {
      "font-size": [
        {
          text: [
            "display-xl",
            "display-lg",
            "heading-xl",
            "heading-lg",
            "heading-md",
            "body-md",
            "body-sm",
            "caption",
          ],
        },
      ],
    },
  },
})
