import SectionHeading from "@/components/SectionHeading";
import GalleryContent from "@/components/GalleryContent";

const galleryItems = [
  {
    title: "Mewtwo",
    description: "Major creases and surface scratches.",
    beforeFront: "/gallery/mewtwo-before-front.webp",
    beforeFrontVideo: "/gallery/mewtwo-before-front.mp4",
    beforeBack: "/gallery/mewtwo-before-back.webp",
    beforeBackVideo: "/gallery/mewtwo-before-back.mp4",
    afterFront: "/gallery/mewtwo-after-front.webp",
    afterFrontVideo: "/gallery/mewtwo-after-front.mp4",
    afterBack: "/gallery/mewtwo-after-back.webp",
    afterBackVideo: "/gallery/mewtwo-after-back.mp4",
  },
  {
    title: "Scizor",
    description: "Edge lift and creases.",
    beforeFront: "/gallery/scizor-before-front.webp",
    beforeFrontVideo: "/gallery/scizor-before-front.mp4",
    beforeBack: "/gallery/scizor-before-back.webp",
    beforeBackVideo: "/gallery/scizor-before-back.mp4",
    afterFront: "/gallery/scizor-after-front.webp",
    afterFrontVideo: "/gallery/scizor-after-front.mp4",
    afterBack: "/gallery/scizor-after-back.webp",
    afterBackVideo: "/gallery/scizor-after-back.mp4",
  },
];

export default function GalleryPage() {
  return (
    <div className="mx-auto max-w-4xl px-6 py-12">
      <div className="animate-fade-up">
        <SectionHeading subtitle="Real restorations from our workshop.">
          Gallery
        </SectionHeading>
      </div>

      <GalleryContent items={galleryItems} />
    </div>
  );
}
