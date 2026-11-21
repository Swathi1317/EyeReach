function drawImage3D(ctx, img, x, y, width, height, yaw) {
    // We want to simulate rotateY(yaw). 
    // yaw is in radians (e.g., -0.5 to 0.5)
    // Left edge and right edge heights will differ.
    
    const slices = 30;
    const sliceW = img.naturalWidth / slices;
    
    // Calculate z-depths for left and right edges to simulate perspective
    // Assuming center is z=0
    // A positive yaw means head turned right (user right ear exposed).
    // In our unmirrored setup, user right ear is small X (left side of image).
    // So if yaw > 0, left side of image is closer (taller), right side is farther (shorter).
    
    const maxZ = Math.sin(yaw) * width / 2;
    // Perspective formula: scale = focal_length / (focal_length + z)
    const focal = width * 1.5; 
    
    for (let i = 0; i < slices; i++) {
        // -0.5 to 0.5
        const normalizedX = (i / (slices - 1)) - 0.5;
        
        // Z increases linearly across the image width
        const z = normalizedX * maxZ * 2; 
        const scale = focal / (focal + z);
        
        // Projected position
        // We want the total projected width to be smaller.
        // We accumulate widths, or just map linearly and then scale.
        const projX = x + (normalizedX * width * scale);
        const projW = (width / slices) * scale;
        const projH = height * scale;
        
        const srcX = i * sliceW;
        
        ctx.drawImage(
            img,
            srcX, 0, sliceW, img.naturalHeight,
            projX - projW/2, y - projH/2, projW * 1.05, projH // 1.05 width overlap to prevent gaps
        );
    }
}
