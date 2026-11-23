# Step 3: Photos of handwritten work

The learner attaches a photo of their page and gets help on their own lines.

- The page sends each photo to your server (`POST /api/upload`), never to Learn directly.
- Your server uploads it to Learn with `POST /v1/quest/attachments` for the learner's session. Uploading is free and returns an `attachment_id`.
- The learner's next message carries the ids in `quest.attachment_ids`, up to four per turn.

PNG, JPEG and WebP up to 8 MiB each, 6,000 pixels per side. Check that photos are legible and show the work. Uploads are private to the learner and session and expire 30 days after upload.

## Run it

```sh
cp .env.example .env        # then put your key in .env
npm start
```

Open http://localhost:3000, choose **Feedback**, attach a photo of written work and ask for a check. The reply speaks to the lines in the photo.

Starts from step 2 (`02-four-kinds-of-help`).
